(function (root) {
  'use strict';

  const ns = (root.__VBGPP__ = root.__VBGPP__ || {});

  // Guard against double injection if background dynamically registers on an already-matched tab
  if (ns.__initialized) return;
  ns.__initialized = true;

  let settings = ns.core.normalizeSettings(ns.core.DEFAULT_SETTINGS);
  const trackedMedia = new Set();
  let activeMedia = null;
  let saveTimer = null;

  const audioEngine = ns.createAudioEngine();

  function getSettings() {
    return settings;
  }

  function pickBestMedia() {
    const list = Array.from(trackedMedia).filter((m) => m && m.isConnected !== false);
    if (list.length === 0) return null;
    const playing = list.find((m) => !m.paused && !m.ended);
    if (playing) return playing;
    const withSource = list.find((m) => (m.currentSrc || m.src) && (m.readyState > 0 || m.duration > 0));
    if (withSource) return withSource;
    return list[0];
  }

  function getActiveMedia() {
    if (activeMedia && activeMedia.isConnected !== false && trackedMedia.has(activeMedia)) {
      if (!activeMedia.paused) return activeMedia;
    }
    activeMedia = pickBestMedia();
    return activeMedia;
  }

  const resilience = ns.createResilienceController({
    getSettings,
    getActiveMedia,
    audioEngine,
  });

  const mediaSession = ns.createMediaSessionController({
    getSettings,
    getActiveMedia,
    resilience,
    audioEngine,
  });

  function persistSettingsSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        browser.storage.local.set({ vbgppSettings: settings }).catch(() => {});
      } catch (_) {}
    }, 120);
  }

  function applySettingsToAllMedia() {
    const pending = [];
    for (const media of trackedMedia) {
      if (media.isConnected === false) {
        trackedMedia.delete(media);
        continue;
      }
      pending.push(audioEngine.applyToMedia(media, settings));
    }
    resilience.onSettingsChanged(settings);
    mediaSession.onSettingsChanged();
    quickPill.render();
    if (pending.length > 0) {
      Promise.all(pending).then(() => quickPill.render()).catch(() => {});
    }
  }

  function updateSetting(key, value) {
    if (key === 'speed' || key === 'pitchSemitones' || key === 'linkPitchAndSpeed') {
      settings = ns.core.updateSpeedOrPitch(settings, key, value);
    } else {
      settings = ns.core.normalizeSettings({ ...settings, [key]: value });
    }
    applySettingsToAllMedia();
    persistSettingsSoon();
  }

  const quickPill = ns.createQuickPill({
    getSettings,
    updateSetting,
    mediaSession,
    getActiveMedia,
    audioEngine,
  });

  function bindMediaElement(media) {
    if (!media || trackedMedia.has(media)) return;
    if (!(media instanceof HTMLMediaElement)) return;

    trackedMedia.add(media);
    activeMedia = getActiveMedia();

    resilience.attachMedia(media);
    mediaSession.attachMedia(media);
    audioEngine.applyToMedia(media, settings);

    media.addEventListener('play', () => {
      activeMedia = media;
      audioEngine.applyToMedia(media, settings);
      quickPill.render();
    });

    media.addEventListener('loadedmetadata', () => {
      activeMedia = getActiveMedia();
      audioEngine.applyToMedia(media, settings);
      quickPill.render();
    });

    media.addEventListener('ratechange', () => {
      const mode = ns.core.resolvePlaybackAudioMode(settings);
      if (settings.enabled && Math.abs(media.playbackRate - mode.playbackRate) > 0.005) {
        audioEngine.applyToMedia(media, settings);
      }
    });

    quickPill.render();
  }

  function scanForMedia(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') return;
    const elements = rootNode.querySelectorAll('video, audio');
    for (const el of elements) {
      bindMediaElement(el);
    }
  }

  // Capture play/loadedmetadata on document to catch media inside Shadow DOM too
  ['play', 'loadedmetadata', 'durationchange'].forEach((evtName) => {
    document.addEventListener(
      evtName,
      (evt) => {
        if (evt.target instanceof HTMLMediaElement) {
          bindMediaElement(evt.target);
        }
      },
      true
    );
  });

  function startDomObserver() {
    scanForMedia(document);
    if (!document.documentElement) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLMediaElement) {
            bindMediaElement(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            scanForMedia(node);
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startDomObserver, { once: true });
  } else {
    startDomObserver();
  }

  // Load initial settings
  try {
    browser.storage.local
      .get('vbgppSettings')
      .then((res) => {
        if (res && res.vbgppSettings) {
          settings = ns.core.normalizeSettings(res.vbgppSettings);
          applySettingsToAllMedia();
        }
      })
      .catch(() => {});

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.vbgppSettings) return;
      settings = ns.core.normalizeSettings(changes.vbgppSettings.newValue);
      applySettingsToAllMedia();
    });
  } catch (_) {}

  // Handle commands & status queries from Popup
  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (!msg || typeof msg.type !== 'string') return false;

      if (msg.type === 'vbgpp:getState') {
        const media = getActiveMedia();
        if (media) {
          return Promise.resolve({
            hasMedia: true,
            paused: media.paused,
            currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0,
            duration: Number.isFinite(media.duration) ? media.duration : 0,
            title: document.title || window.location.hostname,
            audioStatus: audioEngine.getStatus(),
            audioError: audioEngine.getError(),
            resilience: resilience.getDebugState(),
          });
        }
        if (window === window.top) {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                hasMedia: false,
                title: document.title || window.location.hostname,
                audioStatus: audioEngine.getStatus(),
                resilience: resilience.getDebugState(),
              });
            }, 40);
          });
        }
        return false;
      }

      if (msg.type === 'vbgpp:command') {
        const media = getActiveMedia();
        if (!media && msg.command !== 'ping') return false;
        const step = settings.seekStep || 5;
        switch (msg.command) {
          case 'play':
            mediaSession.playMedia();
            break;
          case 'pause':
            mediaSession.pauseMedia();
            break;
          case 'togglePlayPause':
            mediaSession.togglePlayPause();
            break;
          case 'stop':
            mediaSession.stopMedia();
            break;
          case 'restart':
            mediaSession.restartTrack(true);
            break;
          case 'seekBack':
            mediaSession.seekBy(-(Number(msg.delta) || step));
            break;
          case 'seekForward':
            mediaSession.seekBy(Number(msg.delta) || step);
            break;
          default:
            break;
        }
        quickPill.render();
        return Promise.resolve({ ok: true, paused: media ? media.paused : true });
      }

      return false;
    });
  } catch (_) {}
})(typeof globalThis !== 'undefined' ? globalThis : this);

