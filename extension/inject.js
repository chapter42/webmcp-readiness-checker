/**
 * @file inject.js
 * Runs in the page's MAIN world.
 *
 * Loaded two ways:
 *   1. Declared in manifest.json as a MAIN-world content script at
 *      document_start — the normal path, so we can monkey-patch
 *      navigator.modelContext.registerTool BEFORE any page script calls it.
 *   2. Dynamically injected by background.js via chrome.scripting.executeScript
 *      as a fallback for tabs that were already open when the extension was
 *      installed/reloaded. In that case the page has usually already finished
 *      registering tools and we won't be able to enumerate them — but we'll
 *      still capture any future registrations.
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
      try {
        window.dispatchEvent(new CustomEvent('webmcp-checker-main-results', {
          detail: snapshot(),
        }));
      } catch (_) { /* ignore */ }
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
   * Try to wrap both the production and testing modelContext objects if they
   * exist. Safe to call repeatedly — `wrap` is idempotent via the marker flag.
   */
  function tryWrap() {
    try {
      if (navigator.modelContext) wrap(navigator.modelContext);
    } catch (_) { /* ignore */ }
    try {
      if (navigator.modelContextTesting) wrap(navigator.modelContextTesting);
    } catch (_) { /* ignore */ }
  }

  tryWrap();

  // Some implementations may lazily expose modelContext. Poll briefly.
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
      modelContextAvailable = typeof navigator.modelContext !== 'undefined' && !!navigator.modelContext;
    } catch (_) { /* ignore */ }
    try {
      modelContextTestingAvailable = typeof navigator.modelContextTesting !== 'undefined' && !!navigator.modelContextTesting;
    } catch (_) { /* ignore */ }

    var tools = [];
    try {
      var values = Array.from(registry.values());
      for (var i = 0; i < values.length; i++) {
        var tool = values[i];
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
      tools: tools,
    };
  }

  /**
   * Respond to snapshot requests from the ISOLATED-world content script.
   */
  window.addEventListener('webmcp-checker-main-request', function () {
    try {
      window.dispatchEvent(new CustomEvent('webmcp-checker-main-results', {
        detail: snapshot(),
      }));
    } catch (_) { /* ignore */ }
  });

  // Expose a debug handle so users can inspect state from devtools with
  // `window.__webmcpChecker.snapshot()` or `window.__webmcpChecker.registry`.
  try {
    Object.defineProperty(window, '__webmcpChecker', {
      value: {
        snapshot: snapshot,
        registry: registry,
        tryWrap: tryWrap,
      },
      enumerable: false,
      configurable: false,
    });
  } catch (_) { /* ignore */ }

  // Also broadcast once on load so content scripts that were waiting for us
  // (e.g. the content script raced us to initialization) receive data
  // without having to re-request.
  try {
    window.dispatchEvent(new CustomEvent('webmcp-checker-main-results', {
      detail: snapshot(),
    }));
  } catch (_) { /* ignore */ }
})();
