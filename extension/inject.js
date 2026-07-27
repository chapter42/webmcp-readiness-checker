/**
 * @file inject.js
 * Runs in the page's MAIN world.
 *
 * Loaded two ways:
 *   1. Declared in manifest.json as a MAIN-world content script at
 *      document_start — the normal path, so we can monkey-patch
 *      registerTool BEFORE any page script calls it.
 *   2. Dynamically injected by background.js via chrome.scripting.executeScript
 *      as a fallback for tabs that were already open when the extension was
 *      installed/reloaded.
 *
 * API surface (WebMCP draft as of July 2026):
 *   - `document.modelContext` is the current location. `navigator.modelContext`
 *     was deprecated in Chromium 150 but still ships during the Chrome 149-156
 *     origin trial, so we watch BOTH and record which one the page uses.
 *   - `getTools()` enumerates registered tools directly — far more reliable
 *     than our shadow registry, so we prefer it when available and fall back
 *     to the registerTool monkey-patch otherwise.
 *   - `toolchange` fires whenever the tool set changes. This is the correct
 *     replacement for polling, and it is also the ONLY way we learn about
 *     AbortSignal-driven unregistration — `unregisterTool()` was removed from
 *     the spec in April 2026, so a wrapped unregisterTool no longer sees
 *     teardown and the shadow registry would otherwise report stale tools.
 *
 * Communication with the ISOLATED-world content.js uses CustomEvents:
 *   - content.js dispatches `webmcp-checker-main-request` to ask for a snapshot
 *   - inject.js dispatches `webmcp-checker-main-results` with a snapshot object
 */
(function () {
  'use strict';

  // Double-load guard — both the declared content script and the dynamic
  // fallback may try to run; only the first initialization wins.
  if (window.__webmcpCheckerMainLoaded) return;
  window.__webmcpCheckerMainLoaded = true;

  /** @type {Map<string, object>} Shadow registry of registered tools by name. */
  var registry = new Map();

  /** @type {boolean} Have we observed a real registerTool method on modelContext? */
  var methodDetected = false;

  /** @type {number} Auto-generated key for tools without a usable name. */
  var anonCounter = 0;

  /** @type {boolean} Page exposes the current `document.modelContext` surface. */
  var documentSurface = false;

  /** @type {boolean} Page exposes the deprecated `navigator.modelContext` surface. */
  var navigatorSurface = false;

  /** @type {boolean} The live `getTools()` accessor is available on some surface. */
  var getToolsAvailable = false;

  /** @type {Array<object>|null} Most recent live `getTools()` result, if any. */
  var liveTools = null;

  /**
   * Record a tool registration. Lenient: captures anything that looks
   * remotely like a tool def, using a fallback key if `name` is missing.
   * @param {*} toolDef
   */
  function capture(toolDef) {
    try {
      if (!toolDef || typeof toolDef !== 'object') return;
      var key = (typeof toolDef.name === 'string' && toolDef.name)
        ? toolDef.name
        : '__webmcp_anon_' + (anonCounter++);
      registry.set(key, toolDef);
      // Reactive dispatch — content.js may have already snapshotted
      // before this tool was registered, so emit a fresh snapshot.
      emit();
    } catch (_) { /* ignore */ }
  }

  /**
   * Dispatch the current snapshot to the ISOLATED-world content script.
   */
  function emit() {
    try {
      window.dispatchEvent(new CustomEvent('webmcp-checker-main-results', {
        detail: snapshot(),
      }));
    } catch (_) { /* ignore */ }
  }

  /**
   * Remove a tool from the shadow registry.
   * @param {string} name
   */
  function uncapture(name) {
    try { registry.delete(name); } catch (_) { /* ignore */ }
  }

  /**
   * Wrap a single property (registerTool or unregisterTool) on the given
   * target object so calls pass through our interceptor. Tries to use
   * defineProperty so the wrap survives even on frozen / prototype objects.
   *
   * @param {object} target     - object that owns (or inherits) the property
   * @param {string} propName   - "registerTool" or "unregisterTool"
   * @param {Function} interceptor - called with (args, thisArg) before orig
   */
  function wrapMethod(target, propName, interceptor) {
    if (!target) return false;
    var desc = null;
    try { desc = Object.getOwnPropertyDescriptor(target, propName); } catch (_) { /* ignore */ }

    var orig = null;
    try { orig = target[propName]; } catch (_) { /* ignore */ }
    if (typeof orig !== 'function') return false;

    var wrapped = function () {
      try { interceptor(arguments, this); } catch (_) { /* ignore */ }
      return orig.apply(this, arguments);
    };

    // Try defineProperty first (works on prototype objects and respects
    // existing descriptors). Fall back to plain assignment.
    try {
      Object.defineProperty(target, propName, {
        value: wrapped,
        writable: desc ? desc.writable !== false : true,
        configurable: true,
        enumerable: desc ? desc.enumerable : false,
      });
      return true;
    } catch (_) { /* ignore */ }

    try {
      target[propName] = wrapped;
      return target[propName] === wrapped;
    } catch (_) { /* ignore */ }

    return false;
  }

  /**
   * Wrap registerTool / unregisterTool on a modelContext-like object (and
   * its prototype chain) so we mirror every registration into the shadow
   * registry. Some implementations expose these methods on the instance,
   * others on the prototype — try both.
   * @param {object} ctx
   */
  function wrap(ctx) {
    if (!ctx) return;
    try {
      if (ctx.__webmcpCheckerWrapped) return;
    } catch (_) { return; }

    var onRegister = function (args) { capture(args[0]); };
    var onUnregister = function (args) {
      var arg = args[0];
      if (typeof arg === 'string') uncapture(arg);
      else if (arg && typeof arg.name === 'string') uncapture(arg.name);
    };

    // Walk the prototype chain and wrap the first level where each method
    // exists. Also attempt the instance level for good measure.
    var targets = [ctx];
    try {
      var proto = Object.getPrototypeOf(ctx);
      var depth = 0;
      while (proto && depth < 5) {
        targets.push(proto);
        proto = Object.getPrototypeOf(proto);
        depth++;
      }
    } catch (_) { /* ignore */ }

    var wrappedRegister = false;
    var wrappedUnregister = false;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!wrappedRegister && wrapMethod(t, 'registerTool', onRegister)) {
        wrappedRegister = true;
        methodDetected = true;
      }
      if (!wrappedUnregister && wrapMethod(t, 'unregisterTool', onUnregister)) {
        wrappedUnregister = true;
      }
      if (wrappedRegister && wrappedUnregister) break;
    }

    // Also detect the method even if wrapping failed, so the scanner can
    // still award partial credit for "API in use".
    if (!methodDetected) {
      try {
        if (typeof ctx.registerTool === 'function') methodDetected = true;
      } catch (_) { /* ignore */ }
    }

    try {
      Object.defineProperty(ctx, '__webmcpCheckerWrapped', {
        value: true,
        enumerable: false,
        configurable: false,
      });
    } catch (_) { /* ignore */ }
  }

  /**
   * Subscribe to the `toolchange` event on a model context. This is how we
   * learn about AbortSignal-driven unregistration — since `unregisterTool()`
   * was removed from the spec, wrapping it is no longer sufficient and the
   * shadow registry would keep reporting torn-down tools.
   * @param {object} ctx
   */
  function watchToolChange(ctx) {
    if (!ctx || typeof ctx.addEventListener !== 'function') return;
    try {
      if (ctx.__webmcpCheckerWatched) return;
    } catch (_) { return; }

    try {
      ctx.addEventListener('toolchange', function () {
        refreshLiveTools();
        emit();
      });
      Object.defineProperty(ctx, '__webmcpCheckerWatched', {
        value: true, enumerable: false, configurable: false,
      });
    } catch (_) { /* ignore */ }
  }

  /**
   * Pull the authoritative tool list from `getTools()` when the browser
   * provides it. Preferred over the shadow registry: it reflects the real
   * current state including tools registered before we loaded and tools
   * removed via AbortSignal.
   */
  function refreshLiveTools() {
    var ctx = activeContext();
    if (!ctx || typeof ctx.getTools !== 'function') return;

    getToolsAvailable = true;
    // getTools() returns a Promise in the current draft, but tolerate a
    // synchronous array from older or polyfilled implementations. Wrapped in
    // an async IIFE because the callers (tryWrap, the toolchange handler) are
    // synchronous and must not wait on this.
    (async function () {
      try {
        var result = await ctx.getTools();
        if (Array.isArray(result)) {
          liveTools = result;
          emit();
        }
      } catch (_) { /* ignore */ }
    })();
  }

  /**
   * The model context object the page is actually using, preferring the
   * current `document.modelContext` location over the deprecated one.
   * @returns {object|null}
   */
  function activeContext() {
    try { if (document.modelContext) return document.modelContext; } catch (_) { /* ignore */ }
    try { if (navigator.modelContext) return navigator.modelContext; } catch (_) { /* ignore */ }
    try { if (navigator.modelContextTesting) return navigator.modelContextTesting; } catch (_) { /* ignore */ }
    return null;
  }

  /**
   * Wrap and watch every model context surface the page exposes. Safe to call
   * repeatedly — `wrap` and `watchToolChange` are idempotent via marker flags.
   */
  function tryWrap() {
    try {
      if (document.modelContext) {
        documentSurface = true;
        wrap(document.modelContext);
        watchToolChange(document.modelContext);
      }
    } catch (_) { /* ignore */ }
    try {
      if (navigator.modelContext) {
        navigatorSurface = true;
        wrap(navigator.modelContext);
        watchToolChange(navigator.modelContext);
      }
    } catch (_) { /* ignore */ }
    try {
      if (navigator.modelContextTesting) wrap(navigator.modelContextTesting);
    } catch (_) { /* ignore */ }
    refreshLiveTools();
  }

  tryWrap();

  // Some implementations expose modelContext lazily. Poll briefly as a
  // backstop; once `toolchange` is wired up it carries subsequent updates.
  var attempts = 0;
  var pollId = setInterval(function () {
    tryWrap();
    if (++attempts >= 20) clearInterval(pollId); // ~2 seconds
  }, 100);

  /**
   * Build a serializable snapshot of the current MAIN-world state for the
   * content script.
   * @returns {object}
   */
  function snapshot() {
    var modelContextAvailable = false;
    var modelContextTestingAvailable = false;
    try {
      modelContextAvailable = !!(document.modelContext || navigator.modelContext);
    } catch (_) { /* ignore */ }
    try {
      modelContextTestingAvailable = typeof navigator.modelContextTesting !== 'undefined' && !!navigator.modelContextTesting;
    } catch (_) { /* ignore */ }

    // Prefer the browser's own `getTools()` result — it is authoritative and
    // already accounts for AbortSignal teardown. Fall back to the shadow
    // registry built from intercepted registerTool calls.
    var source = (liveTools && liveTools.length) ? liveTools : null;
    var values = [];
    try {
      values = source ? source.slice() : Array.from(registry.values());
    } catch (_) { /* ignore */ }

    var tools = [];
    try {
      for (var i = 0; i < values.length; i++) {
        var tool = values[i];
        if (!tool || typeof tool !== 'object') continue;
        try {
          // Pull primitive fields first, then JSON-sanitize inputSchema /
          // annotations so we never try to structured-clone functions,
          // Proxies, or class instances across the world boundary. The
          // sidepanel only needs the shape for display.
          var safe = {
            name: typeof tool.name === 'string' ? tool.name : String(tool.name || ''),
            description: typeof tool.description === 'string'
              ? tool.description
              : String(tool.description || ''),
            inputSchema: null,
            annotations: null,
            source: 'imperative',
            // Whether this tool declares a handler at all. `execute` is the
            // current spec name; `handler` was the pre-2026 spelling.
            hasExecute: typeof tool.execute === 'function' || typeof tool.handler === 'function',
          };
          try {
            var rawSchema = tool.inputSchema || tool.input_schema || tool.schema || null;
            if (rawSchema) safe.inputSchema = JSON.parse(JSON.stringify(rawSchema));
          } catch (_) { /* leave null */ }
          try {
            if (tool.annotations) safe.annotations = JSON.parse(JSON.stringify(tool.annotations));
          } catch (_) { /* leave null */ }
          tools.push(safe);
        } catch (_) { /* skip bad entry */ }
      }
    } catch (_) { /* ignore */ }

    return {
      modelContextAvailable: modelContextAvailable,
      modelContextTestingAvailable: modelContextTestingAvailable,
      methodDetected: methodDetected,
      // Which API surface the page actually uses. `document.modelContext` is
      // current; `navigator.modelContext` is deprecated as of Chromium 150.
      documentSurface: documentSurface,
      navigatorSurface: navigatorSurface,
      // True when the browser exposes the live getTools() accessor, meaning
      // the tool list below is authoritative rather than reconstructed.
      getToolsAvailable: getToolsAvailable,
      toolsAreLive: !!(liveTools && liveTools.length),
      tools: tools,
    };
  }

  /**
   * Respond to snapshot requests from the ISOLATED-world content script.
   */
  window.addEventListener('webmcp-checker-main-request', function () {
    tryWrap();
    emit();
  });

  // Expose a debug handle so users can inspect state from devtools with
  // `window.__webmcpChecker.snapshot()` or `window.__webmcpChecker.registry`.
  try {
    Object.defineProperty(window, '__webmcpChecker', {
      value: {
        snapshot: snapshot,
        registry: registry,
        tryWrap: tryWrap,
        refreshLiveTools: refreshLiveTools,
      },
      enumerable: false,
      configurable: false,
    });
  } catch (_) { /* ignore */ }

  // Also broadcast once on load so content scripts that were waiting for us
  // (e.g. the content script raced us to initialization) receive data
  // without having to re-request.
  emit();
})();
