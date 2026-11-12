'use strict';

const CONTENT_FILES = [
  'content/core-logic.js',
  'content/resilience.js',
  'content/pitch-worklet.js',
  'content/audio-engine.js',
  'content/media-session.js',
  'content/quick-pill.js',
  'content/main.js',
];

const registeredScripts = new Map();

async function registerSiteScript(originPattern) {
  if (!originPattern || registeredScripts.has(originPattern)) return;
  if (!browser.contentScripts || typeof browser.contentScripts.register !== 'function') return;

  try {
    const hasPerm = await browser.permissions.contains({ origins: [originPattern] });
    if (!hasPerm) return;

    const handle = await browser.contentScripts.register({
      matches: [originPattern],
      js: CONTENT_FILES.map((file) => ({ file })),
      runAt: 'document_start',
      allFrames: true,
    });
    registeredScripts.set(originPattern, handle);
  } catch (_) {}
}

async function unregisterSiteScript(originPattern) {
  const handle = registeredScripts.get(originPattern);
  if (handle) {
    try {
      await handle.unregister();
    } catch (_) {}
    registeredScripts.delete(originPattern);
  }
}

async function injectIntoTabNow(tabId) {
  if (typeof tabId !== 'number') return;
  for (const file of CONTENT_FILES) {
    try {
      await browser.tabs.executeScript(tabId, {
        file,
        allFrames: true,
        runAt: 'document_start',
      });
    } catch (_) {}
  }
}

async function restoreCustomSites() {
  try {
    const res = await browser.storage.local.get('vbgppSettings');
    const customSites = res?.vbgppSettings?.customSites;
    if (Array.isArray(customSites)) {
      for (const pattern of customSites) {
        await registerSiteScript(pattern);
      }
    }
  } catch (_) {}
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'vbgpp:enableSite') {
    return (async () => {
      const pattern = msg.originPattern;
      if (!pattern) return { ok: false };
      const res = await browser.storage.local.get('vbgppSettings');
      const current = res?.vbgppSettings || {};
      const list = Array.isArray(current.customSites) ? current.customSites : [];
      if (!list.includes(pattern)) {
        list.push(pattern);
      }
      await browser.storage.local.set({
        vbgppSettings: { ...current, customSites: list },
      });
      await registerSiteScript(pattern);
      if (typeof msg.tabId === 'number') {
        await injectIntoTabNow(msg.tabId);
      }
      return { ok: true };
    })();
  }

  if (msg.type === 'vbgpp:disableSite') {
    return (async () => {
      const pattern = msg.originPattern;
      if (!pattern) return { ok: false };
      await unregisterSiteScript(pattern);
      const res = await browser.storage.local.get('vbgppSettings');
      const current = res?.vbgppSettings || {};
      const list = Array.isArray(current.customSites)
        ? current.customSites.filter((p) => p !== pattern)
        : [];
      await browser.storage.local.set({
        vbgppSettings: { ...current, customSites: list },
      });
      try {
        await browser.permissions.remove({ origins: [pattern] });
      } catch (_) {}
      return { ok: true };
    })();
  }

  return false;
});

browser.runtime.onInstalled.addListener(() => {
  restoreCustomSites();
});

restoreCustomSites();

