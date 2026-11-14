/* English Study — background service worker (Manifest V3) */

const MENU_SELECTION = 'english-study-selection';
const MENU_CROP = 'english-study-crop';
const MAX_SELECTION_CHARS = 20000;

let panelBehaviorSet = false;

/* ------------------------------------------------------------------ */
/* Installation / startup                                              */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  setupExtension().catch((error) => console.warn('[English Study] setup:', error));
});

chrome.runtime.onStartup.addListener(() => {
  setupExtension().catch((error) => console.warn('[English Study] startup:', error));
});

async function setupExtension() {
  await ensureContextMenus();
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    panelBehaviorSet = true;
  } catch (error) {
    panelBehaviorSet = false;
    console.warn('[English Study] sidePanel behavior:', error);
  }
}

function ensureContextMenus() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create({
        id: MENU_SELECTION,
        title: '📖 English Study: সিলেকশনটি অনুবাদ করুন',
        contexts: ['selection']
      });
      chrome.contextMenus.create({
        id: MENU_CROP,
        title: '✂️ English Study: এই অংশটি স্ক্যান করুন',
        contexts: ['page', 'selection', 'image']
      });
      resolve();
    });
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (panelBehaviorSet || !tab || !tab.id) {
    return;
  }
  chrome.sidePanel
    .open({ tabId: tab.id })
    .catch((error) => console.warn('[English Study] open panel:', error));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) {
    return;
  }
  const isSelection = info.menuItemId === MENU_SELECTION;
  const text = isSelection ? String(info.selectionText || '').slice(0, MAX_SELECTION_CHARS) : '';
  const intent = {
    id: createId(),
    type: isSelection ? 'selection' : 'crop',
    text,
    url: tab.url || '',
    title: tab.title || '',
    createdAt: Date.now()
  };
  openPanelAndDeliverIntent(tab, intent);
});

async function openPanelAndDeliverIntent(tab, intent) {
  const openPromise = chrome.sidePanel.open({ tabId: tab.id }).catch((error) => {
    console.warn('[English Study] sidePanel.open:', error);
  });

  try {
    await chrome.storage.session.set({ pendingIntent: intent });
  } catch (error) {
    console.warn('[English Study] pending intent:', error);
  }

  await openPromise;
  broadcast({ type: 'INTENT', intent });
  setTimeout(() => broadcast({ type: 'INTENT', intent }), 900);
  setTimeout(() => broadcast({ type: 'INTENT', intent }), 1900);
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  handleMessage(message, sender)
    .then((result) => sendResponse(result || { ok: true }))
    .catch((error) => {
      console.warn('[English Study] message error:', message.type, error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_OVERLAY':
      return startOverlay();
    case 'OPEN_CROP_PAGE':
      return openCropPage();
    case 'OVERLAY_CROP':
      return finishOverlayCrop(message, sender);
    case 'OVERLAY_CANCELLED':
      broadcast({ type: 'CROP_CANCELLED' });
      return { ok: true };
    case 'CROP_PAGE_DONE':
      return finishCropPage(message, sender);
    case 'CROP_PAGE_CANCELLED':
      broadcast({ type: 'CROP_CANCELLED' });
      await removeTab(sender?.tab?.id);
      return { ok: true };
    case 'CLOSE_CROP_TAB':
      await removeTab(sender?.tab?.id);
      return { ok: true };
    case 'CONSUME_PENDING':
      return consumePendingIntent();
    case 'GET_TAB_INFO':
      return getActiveTabInfo();
    case 'OPEN_EXTENSIONS_PAGE':
      return openExtensionsPage();
    case 'CAPTURE_ACTIVE_TAB':
      return captureActiveTab();
    case 'AUTH_BROADCAST':
      // Fan out auth/account changes (from the side panel or the admin page)
      // to every other extension view. No data is read or modified here.
      broadcast({ type: 'AUTH_BROADCAST', payload: message.payload || null });
      return { ok: true };
    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

/* ------------------------------------------------------------------ */
/* Overlay + screenshot flow                                           */
/* ------------------------------------------------------------------ */

async function startOverlay() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return { ok: false, error: 'কোনো সক্রিয় ট্যাব পাওয়া যায়নি।' };
  }

  if (isRestrictedUrl(tab.url)) {
    return {
      ok: false,
      fallback: true,
      error: 'এই পেজে সরাসরি ক্রপ ওভারলে চালু করা যায় না। স্ক্রিনশট ক্রপ ব্যবহার করুন।'
    };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['overlay.js']
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      fallback: true,
      error: 'এই পেজে সরাসরি ক্রপ ওভারলে চালু করা যায়নি। স্ক্রিনশট ক্রপ ব্যবহার করা হচ্ছে।',
      detail: error?.message || String(error)
    };
  }
}

async function finishOverlayCrop(message, sender) {
  const rect = sanitizeRect(message.rect);
  const viewport = sanitizeViewport(message.viewport);
  if (!rect || !viewport) {
    return { ok: false, error: 'সিলেকশনের মাপ সঠিক নয়।' };
  }

  const tab = sender?.tab;
  if (!tab || !tab.id) {
    return { ok: false, error: 'ট্যাব শনাক্ত করা যায়নি।' };
  }

  await sleep(190);

  const activeTab = await getActiveTab(tab.windowId);
  if (!activeTab || activeTab.id !== tab.id) {
    return { ok: false, error: 'ট্যাব পরিবর্তিত হয়েছে। আবার স্ক্যান করুন।' };
  }

  try {
    const shot = await captureTab(activeTab);
    const payload = {
      dataUrl: shot.dataUrl,
      rect,
      viewport,
      url: shot.url,
      title: shot.title,
      capturedAt: shot.capturedAt
    };
    try {
      await chrome.storage.session.set({ lastCropCapture: payload });
    } catch (error) {
      console.warn('[English Study] crop backup skipped:', error);
    }
    broadcast({ type: 'CROP_CAPTURED', ...payload });
    return { ok: true };
  } catch (error) {
    broadcast({
      type: 'CROP_FAILED',
      error: screenshotErrorMessage(error)
    });
    return { ok: false, error: screenshotErrorMessage(error) };
  }
}

async function openCropPage() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return { ok: false, error: 'কোনো সক্রিয় ট্যাব পাওয়া যায়নি।' };
  }

  let shot;
  try {
    shot = await captureTab(tab);
  } catch (error) {
    return { ok: false, error: screenshotErrorMessage(error) };
  }

  try {
    await chrome.storage.session.set({
      cropSource: {
        dataUrl: shot.dataUrl,
        url: shot.url,
        title: shot.title,
        capturedAt: shot.capturedAt
      }
    });
  } catch (error) {
    return {
      ok: false,
      error: 'স্ক্রিনশট সংরক্ষণ করা যায়নি। পেজটি খুব বড় হলে আবার চেষ্টা করুন।'
    };
  }

  const cropTab = await chrome.tabs.create({
    url: chrome.runtime.getURL('crop.html'),
    active: true
  });
  return { ok: true, tabId: cropTab.id };
}

async function finishCropPage(message, sender) {
  const dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
  if (!dataUrl.startsWith('data:image/')) {
    return { ok: false, error: 'ক্রপ করা ছবি পাওয়া যায়নি।' };
  }

  const source = await readSession('cropSource');
  const payload = {
    dataUrl,
    url: message.url || source?.url || '',
    title: message.title || source?.title || '',
    capturedAt: Date.now()
  };

  try {
    await chrome.storage.session.set({ cropResult: payload });
  } catch (error) {
    console.warn('[English Study] crop result backup skipped:', error);
  }
  try {
    await chrome.storage.session.remove('cropSource');
  } catch (error) {
    console.warn('[English Study] crop source cleanup:', error);
  }

  broadcast({ type: 'CROP_PAGE_DONE', ...payload });

  const senderTabId = sender?.tab?.id;
  if (senderTabId) {
    setTimeout(() => removeTab(senderTabId), 500);
  }
  return { ok: true };
}

async function captureActiveTab() {
  const tab = await getActiveTab();
  if (!tab) {
    return { ok: false, error: 'কোনো সক্রিয় ট্যাব পাওয়া যায়নি।' };
  }
  try {
    const shot = await captureTab(tab);
    return { ok: true, ...shot };
  } catch (error) {
    return { ok: false, error: screenshotErrorMessage(error) };
  }
}

async function captureTab(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'jpeg',
    quality: 95
  });
  return {
    dataUrl,
    url: tab.url || '',
    title: tab.title || '',
    capturedAt: Date.now()
  };
}

/* ------------------------------------------------------------------ */
/* Storage / helpers                                                   */
/* ------------------------------------------------------------------ */

async function consumePendingIntent() {
  let intent = null;
  try {
    const data = await chrome.storage.session.get('pendingIntent');
    intent = data.pendingIntent || null;
    if (intent) {
      const age = Date.now() - Number(intent.createdAt || 0);
      if (age > 120000) {
        intent = null;
      }
    }
    await chrome.storage.session.remove('pendingIntent');
  } catch (error) {
    console.warn('[English Study] consume pending:', error);
  }
  return { ok: true, intent };
}

async function getActiveTabInfo() {
  const tab = await getActiveTab();
  if (!tab) {
    return { ok: false, error: 'কোনো সক্রিয় ট্যাব পাওয়া যায়নি।' };
  }
  return { ok: true, tab: { id: tab.id, url: tab.url || '', title: tab.title || '' } };
}

async function getActiveTab(windowId) {
  const query = { active: true };
  if (typeof windowId === 'number') {
    query.windowId = windowId;
  } else {
    query.currentWindow = true;
  }
  const tabs = await chrome.tabs.query(query);
  return tabs && tabs[0] ? tabs[0] : null;
}

async function readSession(key) {
  try {
    const data = await chrome.storage.session.get(key);
    return data && data[key] ? data[key] : null;
  } catch (error) {
    return null;
  }
}

async function openExtensionsPage() {
  const url = `chrome://extensions/?id=${chrome.runtime.id}`;
  try {
    await chrome.tabs.create({ url });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: 'chrome://extensions পেজটি স্বয়ংক্রিয়ভাবে খোলা যায়নি। ব্রাউজারের অ্যাড্রেস বারে chrome://extensions লিখুন।'
    };
  }
}

async function removeTab(tabId) {
  if (!tabId) {
    return;
  }
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    console.warn('[English Study] remove tab:', error);
  }
}

function broadcast(payload) {
  try {
    const result = chrome.runtime.sendMessage(payload);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (error) {
    /* No receiver open — safe to ignore. */
  }
}

function sanitizeRect(rect) {
  if (!rect || typeof rect !== 'object') {
    return null;
  }
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }
  if (width < 6 || height < 6) {
    return null;
  }
  return { x, y, width, height };
}

function sanitizeViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') {
    return null;
  }
  const width = Number(viewport.width);
  const height = Number(viewport.height);
  if (![width, height].every(Number.isFinite) || width < 50 || height < 50) {
    return null;
  }
  return { width, height };
}

function isRestrictedUrl(url) {
  if (!url) {
    return true;
  }
  return /^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url) ||
    /^https:\/\/chrome\.google\.com\/webstore\//i.test(url);
}

function screenshotErrorMessage(error) {
  const detail = String(error?.message || error || '');
  if (/file:|file URL|file access|Cannot access contents of url "file/i.test(detail)) {
    return 'ফাইল বা PDF পেজের স্ক্রিনশট নিতে ব্যর্থ। chrome://extensions থেকে এই এক্সটেনশনের “Allow access to file URLs” চালু করুন।';
  }
  if (/cannot access|chrome:\/\/|restricted/i.test(detail)) {
    return 'এই পেজটি Chrome অনুমোদন করে না (যেমন chrome:// পেজ)। অন্য একটি ওয়েবপেজ বা PDF খুলে চেষ্টা করুন।';
  }
  return 'স্ক্রিনশট নেওয়া যায়নি। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।';
}

function createId() {
  try {
    return crypto.randomUUID();
  } catch (error) {
    return `intent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Set the action-click behavior as early as possible. */
setupExtension().catch((error) => console.warn('[English Study] initial setup:', error));
