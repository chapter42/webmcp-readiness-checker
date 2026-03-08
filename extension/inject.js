/**
 * @file inject.js
 * Runs in the page's MAIN world (injected via chrome.scripting.executeScript).
 *
 * Detects WebMCP imperative API tools registered via `navigator.modelContext`
 * (or `navigator.modelContextTesting` behind the Chrome 146 flag) and dispatches
 * the results back to the content script in the ISOLATED world via a CustomEvent.
 */
(function () {
  'use strict';

  /** @type {boolean} */
  var modelContextAvailable = false;
  /** @type {boolean} */
  var modelContextTestingAvailable = false;
  /** @type {Array<{name: string, description: string, inputSchema: object|null, annotations: object|null, source: string}>} */
  var tools = [];

  try {
    modelContextAvailable = typeof navigator.modelContext !== 'undefined' && navigator.modelContext !== null;
  } catch (_) {
    // Access may throw in locked-down contexts; treat as unavailable.
  }

  try {
    modelContextTestingAvailable = typeof navigator.modelContextTesting !== 'undefined' && navigator.modelContextTesting !== null;
  } catch (_) {
    // Same guard.
  }

  /**
   * Attempt to read tools from a modelContext-like object.
   * The API shape is experimental so we try several plausible accessors.
   *
   * @param {object} ctx - navigator.modelContext or navigator.modelContextTesting
   * @returns {Promise<Array<{name: string, description: string, inputSchema: object|null, annotations: object|null, source: string}>>}
   */
  async function extractTools(ctx) {
    /** @type {Array<any>} */
    var rawTools = [];

    try {
      // Preferred: async getTools() method
      if (typeof ctx.getTools === 'function') {
        var result = ctx.getTools();
        // Handle both sync and async return values
        if (result && typeof result.then === 'function') {
          rawTools = await result;
        } else {
          rawTools = result;
        }
      }
      // Fallback: a plain .tools property (array or iterable)
      else if (Array.isArray(ctx.tools)) {
        rawTools = ctx.tools;
      }
      // Fallback: tools exposed via a Map-like .entries() method
      else if (ctx.tools && typeof ctx.tools.entries === 'function') {
        rawTools = Array.from(ctx.tools.entries()).map(function (entry) {
          return entry[1];
        });
      }
    } catch (_) {
      // If enumeration fails, return empty.
      return [];
    }

    if (!Array.isArray(rawTools)) {
      try {
        rawTools = Array.from(rawTools);
      } catch (_) {
        return [];
      }
    }

    return rawTools.map(function (tool) {
      try {
        return {
          name: typeof tool.name === 'string' ? tool.name : String(tool.name || ''),
          description: typeof tool.description === 'string' ? tool.description : String(tool.description || ''),
          inputSchema: tool.inputSchema || tool.input_schema || tool.schema || null,
          annotations: tool.annotations || null,
          source: 'imperative',
        };
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Run detection and dispatch results.
   */
  async function run() {
    // Prefer the production API; fall back to the testing variant.
    var ctx = null;

    try {
      if (modelContextAvailable) {
        ctx = navigator.modelContext;
      } else if (modelContextTestingAvailable) {
        ctx = navigator.modelContextTesting;
      }
    } catch (_) {
      // Guard against getters that throw.
    }

    if (ctx) {
      try {
        tools = await extractTools(ctx);
      } catch (_) {
        // Extraction failed; tools stays empty.
      }
    }

    window.dispatchEvent(
      new CustomEvent('webmcp-checker-main-results', {
        detail: {
          modelContextAvailable: modelContextAvailable,
          modelContextTestingAvailable: modelContextTestingAvailable,
          tools: tools,
        },
      })
    );
  }

  run();
})();
