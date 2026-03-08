/**
 * @file background.js
 * Chrome Extension Manifest V3 service worker for webMCP.
 *
 * Responsibilities:
 *  - Open the side panel when the extension icon is clicked.
 *  - Update the badge based on scan results from the content script.
 *  - Fetch discovery files (robots.txt, llms.txt, .well-known/webmcp).
 *  - Inject a MAIN-world script to detect navigator.modelContext.
 *  - Route messages between the content script and the side panel.
 *  - Auto-scan on navigation and SPA history changes.
 */

// ---------------------------------------------------------------------------
// Side panel opening
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    console.error('[webMCP] Failed to open side panel:', err);
  }
});

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

/**
 * Determine the badge color for a given score.
 * @param {number} score - A value between 0 and 100.
 * @returns {{ bg: string, text: string }} Badge background and text colors.
 */
function getBadgeColors(score) {
  if (score >= 70) return { bg: '#22c55e', text: '#ffffff' };
  if (score >= 40) return { bg: '#eab308', text: '#ffffff' };
  return { bg: '#ef4444', text: '#ffffff' };
}

/**
 * Update the extension badge for a specific tab.
 * @param {number} tabId
 * @param {number} score
 */
async function updateBadge(tabId, score) {
  const { bg, text } = getBadgeColors(score);
  try {
    await Promise.all([
      chrome.action.setBadgeText({ text: String(score), tabId }),
      chrome.action.setBadgeBackgroundColor({ color: bg, tabId }),
      chrome.action.setBadgeTextColor({ color: text, tabId }),
    ]);
  } catch (err) {
    console.error('[webMCP] Failed to update badge:', err);
  }
}

// ---------------------------------------------------------------------------
// Discovery file fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a single URL and return its status, body text, and any error.
 * @param {string} url
 * @returns {Promise<{ url: string, status: number|null, content: string|null, error: string|null }>}
 */
async function fetchFile(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const content = await res.text();
    return { url, status: res.status, content, error: null };
  } catch (err) {
    return { url, status: null, content: null, error: err.message };
  }
}

/**
 * Fetch all three discovery files for a given origin.
 * @param {string} origin - e.g. "https://example.com"
 * @returns {Promise<{ robots: object, llms: object, webmcp: object }>}
 */
async function fetchDiscoveryFiles(origin) {
  const [robots, llms, webmcp] = await Promise.all([
    fetchFile(`${origin}/robots.txt`),
    fetchFile(`${origin}/llms.txt`),
    fetchFile(`${origin}/.well-known/webmcp`),
  ]);
  return { robots, llms, webmcp };
}

// ---------------------------------------------------------------------------
// MAIN world script injection
// ---------------------------------------------------------------------------

/**
 * Inject inject.js into the MAIN world of the given tab so it can access
 * navigator.modelContext on the page's own JS context.
 * @param {number} tabId
 */
async function injectMainWorldScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['inject.js'],
      world: 'MAIN',
    });
  } catch (err) {
    console.error('[webMCP] Failed to inject MAIN world script:', err);
  }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === 'SCAN_RESULTS') {
    handleScanResults(message, sender);
    return false;
  }

  if (type === 'REQUEST_SCAN') {
    handleRequestScan(message);
    return false;
  }

  if (type === 'FETCH_DISCOVERY') {
    handleFetchDiscovery(message, sendResponse);
    return true; // keep the message channel open for the async response
  }

  if (type === 'INJECT_MAIN_WORLD') {
    handleInjectMainWorld(message, sender, sendResponse);
    return true;
  }

  if (type === 'ENSURE_CONTENT_SCRIPT') {
    handleEnsureContentScript(message, sendResponse);
    return true;
  }

  return false;
});

/**
 * Handle SCAN_RESULTS from the content script.
 * Updates the badge and forwards the results to the side panel.
 * @param {object} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleScanResults(message, sender) {
  const tabId = sender.tab?.id ?? message.tabId;
  const rawScore = message.data?.score;
  const score = typeof rawScore === 'object' ? (rawScore.total ?? 0) : (rawScore ?? 0);

  if (tabId != null) {
    await updateBadge(tabId, score);
  }

  // Forward to any listening side panel / popup contexts.
  try {
    await chrome.runtime.sendMessage({
      type: 'SCAN_RESULTS',
      data: message.data,
      tabId,
    });
  } catch {
    // Side panel may not be open; that is fine.
  }
}

/**
 * Handle REQUEST_SCAN from the side panel.
 * Sends a message to the content script in the specified tab.
 * @param {object} message
 */
async function handleRequestScan(message) {
  const tabId = message.tabId;
  if (tabId == null) return;

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'REQUEST_SCAN' });
  } catch (err) {
    console.error('[webMCP] Failed to send REQUEST_SCAN to tab:', err);
  }
}

/**
 * Handle FETCH_DISCOVERY requests.
 * Fetches robots.txt, llms.txt, and .well-known/webmcp for the given origin.
 * @param {object} message
 * @param {function} sendResponse
 */
async function handleFetchDiscovery(message, sendResponse) {
  const origin = message.origin;
  if (!origin) {
    sendResponse({ error: 'No origin provided' });
    return;
  }

  try {
    const results = await fetchDiscoveryFiles(origin);
    sendResponse({ data: results });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

/**
 * Handle INJECT_MAIN_WORLD requests from the content script.
 * @param {object} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {function} sendResponse
 */
async function handleInjectMainWorld(message, sender, sendResponse) {
  const tabId = sender.tab?.id ?? message.tabId;
  if (tabId == null) {
    sendResponse({ error: 'No tab id available' });
    return;
  }

  try {
    await injectMainWorldScript(tabId);
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

/**
 * Ensure the content script is injected in the given tab.
 * Needed for tabs that were open before the extension was installed/reloaded.
 * @param {object} message
 * @param {function} sendResponse
 */
async function handleEnsureContentScript(message, sendResponse) {
  const tabId = message.tabId;
  if (tabId == null) {
    sendResponse({ error: 'No tab id' });
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ error: err.message });
  }
}

// No auto-scan — user triggers scans via the side panel Re-scan button.
