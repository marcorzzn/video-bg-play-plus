(function (root) {
  'use strict';

  const ns = (root.__VBGPP__ = root.__VBGPP__ || {});

  const IS_ANDROID = navigator.userAgent.indexOf('Android') > -1;
  const SITE = ns.core.detectSite(window.location.hostname);

  let extensionEnabled = true;
  let lastHiddenEventAt = 0;
  let actualHiddenFlag = false;

  function readNativeHidden() {
    try {
      const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
      if (desc && typeof desc.get === 'function') {
        return Boolean(desc.get.call(document));
      }
    } catch (_) {}
    return actualHiddenFlag;
  }

  // Apply Page Visibility API protections immediately at document_start
  function installEarlyVisibilityGuard() {
    if (IS_ANDROID || !SITE.isDesktopYouTube) {
      try {
        const targetDoc = document.wrappedJSObject || document;
        Object.defineProperties(targetDoc, {
          hidden: { value: false, configurable: true },
          visibilityState: { value: 'visible', configurable: true },
        });
      } catch (_) {}
    }

    window.addEventListener(
      'visibilitychange',
      (evt) => {
        // Track real visibility transitions internally before stopping propagation
        actualHiddenFlag = readNativeHidden();
        lastHiddenEventAt = Date.now();
        if (extensionEnabled) {
          evt.stopImmediatePropagation();
        }
      },
      true
    );

    if (SITE.isVimeo) {
      window.addEventListener(
        'fullscreenchange',
        (evt) => {
          if (extensionEnabled) {
            evt.stopImmediatePropagation();
          }
        },
        true
      );
    }
  }

  installEarlyVisibilityGuard();

  function createResilienceController({ getSettings, getActiveMedia, audioEngine }) {
    let userPaused = false;
    let lastUserInputAt = 0;
    let pauseRetryCount = 0;
    let pauseRetryTimer = null;
    let stallWatchdogTimer = null;
    let activityTimer = null;
    let promptObserver = null;
    let stablePlayTimer = null;
    let lastKnownTime = 0;
    let isRecovering = false;

    const MAX_PAUSE_RETRIES = 5;

    function recordTrustedInput(evt) {
      if (!evt || !evt.isTrusted) return;
      if (evt.type === 'keydown') {
        const k = evt.key;
        if (k !== ' ' && k !== 'k' && k !== 'K' && k !== 'MediaPlayPause' && k !== 'MediaStop') {
          return;
        }
      }
      lastUserInputAt = Date.now();
    }

    window.addEventListener('pointerdown', recordTrustedInput, true);
    window.addEventListener('touchstart', recordTrustedInput, true);
    window.addEventListener('keydown', recordTrustedInput, true);

    function setUserPaused(val) {
      userPaused = Boolean(val);
      if (userPaused) {
        pauseRetryCount = 0;
        isRecovering = false;
        clearTimers();
        audioEngine.setKeepAlive(false);
      }
    }

    function isUserPaused() {
      return userPaused;
    }

    function clearTimers() {
      if (pauseRetryTimer) {
        clearTimeout(pauseRetryTimer);
        pauseRetryTimer = null;
      }
      if (stallWatchdogTimer) {
        clearTimeout(stallWatchdogTimer);
        stallWatchdogTimer = null;
      }
    }

    function sendSyntheticActivity() {
      const settings = getSettings();
      const media = getActiveMedia();
      if (!settings.enabled || !media || media.paused) return;
      try {
        ['keydown', 'keyup'].forEach((type) => {
          document.dispatchEvent(
            new KeyboardEvent(type, {
              bubbles: true,
              cancelable: true,
              keyCode: 18,
              which: 18,
            })
          );
        });
      } catch (_) {}
    }

    function scheduleActivityLoop() {
      if (activityTimer) clearTimeout(activityTimer);
      if (!SITE.isYouTube) return;
      const jitter = Math.floor(Math.random() * 10000) - 5000;
      const delay = 60000 + jitter;
      activityTimer = setTimeout(() => {
        sendSyntheticActivity();
        scheduleActivityLoop();
      }, delay);
    }

    function tryDismissYouTubeInactivityPrompt() {
      const settings = getSettings();
      if (!SITE.isYouTube || !settings.enabled || !settings.autoDismissPrompts) return false;

      // Dedicated YouTube Music "Are you still watching?" renderer
      const ytmPrompt = document.querySelector('ytmusic-you-there-renderer');
      if (ytmPrompt && ytmPrompt.offsetParent !== null) {
        const btn = ytmPrompt.querySelector('button, tp-yt-paper-button, yt-button-renderer');
        if (btn) {
          btn.click();
          return true;
        }
      }

      // YouTube "Video paused. Continue watching?" dialog
      const confirmDialogs = document.querySelectorAll('yt-confirm-dialog-renderer');
      for (const dlg of confirmDialogs) {
        if (dlg.offsetParent === null) continue;
        const text = (dlg.textContent || '').toLowerCase();
        const looksLikeContinuePrompt =
          text.includes('continue') ||
          text.includes('continua') ||
          text.includes('still watching') ||
          text.includes('ancora lì') ||
          text.includes('paus');
        if (!looksLikeContinuePrompt) continue;
        const confirmBtn = dlg.querySelector(
          '#confirm-button button, #confirm-button, .yt-spec-button-shape-next--call-to-action'
        );
        if (confirmBtn) {
          confirmBtn.click();
          return true;
        }
      }
      return false;
    }

    function startPromptObserver() {
      if (!SITE.isYouTube || promptObserver) return;
      const startObs = () => {
        if (!document.body || promptObserver) return;
        promptObserver = new MutationObserver(() => {
          const settings = getSettings();
          if (!settings.enabled || !settings.autoDismissPrompts) return;
          if (tryDismissYouTubeInactivityPrompt()) {
            const media = getActiveMedia();
            if (media && media.paused && !userPaused) {
              media.play().catch(() => {});
            }
          }
        });
        promptObserver.observe(document.body, { childList: true, subtree: true });
      };
      if (document.body) {
        startObs();
      } else {
        document.addEventListener('DOMContentLoaded', startObs, { once: true });
      }
    }

    function attachMedia(media) {
      if (!media || media.__vbgppResilienceBound) return;
      media.__vbgppResilienceBound = true;

      media.addEventListener('play', () => {
        const settings = getSettings();
        extensionEnabled = settings.enabled;
        userPaused = false;
        isRecovering = false;
        clearTimers();
        audioEngine.resumeContextIfNeeded(media);
        audioEngine.setKeepAlive(settings.enabled && settings.keepAlive);

        if (stablePlayTimer) clearTimeout(stablePlayTimer);
        stablePlayTimer = setTimeout(() => {
          pauseRetryCount = 0;
        }, 5000);
      });

      media.addEventListener('playing', () => {
        const settings = getSettings();
        isRecovering = false;
        if (stallWatchdogTimer) {
          clearTimeout(stallWatchdogTimer);
          stallWatchdogTimer = null;
        }
        audioEngine.resumeContextIfNeeded(media);
        audioEngine.setKeepAlive(settings.enabled && settings.keepAlive && !userPaused);
      });

      media.addEventListener('timeupdate', () => {
        if (Number.isFinite(media.currentTime) && media.currentTime > 0) {
          lastKnownTime = media.currentTime;
        }
      });

      media.addEventListener('pause', () => {
        const settings = getSettings();
        extensionEnabled = settings.enabled;
        if (stablePlayTimer) {
          clearTimeout(stablePlayTimer);
          stablePlayTimer = null;
        }

        if (Date.now() - lastUserInputAt < 700) {
          setUserPaused(true);
          return;
        }

        if (tryDismissYouTubeInactivityPrompt()) {
          media.play().catch(() => {});
          return;
        }

        const now = Date.now();
        const recentlyHidden = now - lastHiddenEventAt < 4000;
        const shouldResume = ns.core.shouldAutoResumePause({
          enabled: settings.enabled,
          autoResume: settings.autoResume,
          userPaused,
          ended: media.ended,
          isHidden: readNativeHidden(),
          recentlyHidden,
          retryCount: pauseRetryCount,
          maxRetries: MAX_PAUSE_RETRIES,
        });

        if (!shouldResume) {
          audioEngine.setKeepAlive(false);
          return;
        }

        isRecovering = true;
        const backoffMs = Math.min(3000, 150 * Math.pow(2, pauseRetryCount));
        pauseRetryCount += 1;
        if (pauseRetryTimer) clearTimeout(pauseRetryTimer);
        pauseRetryTimer = setTimeout(() => {
          if (userPaused || media.ended || !media.paused) return;
          audioEngine.resumeContextIfNeeded(media);
          media.play().catch(() => {});
        }, backoffMs);
      });

      const handleStallOrWait = () => {
        const settings = getSettings();
        if (!settings.enabled || !settings.autoResume || userPaused || media.ended) return;
        isRecovering = true;
        audioEngine.setKeepAlive(settings.keepAlive);
        if (stallWatchdogTimer) clearTimeout(stallWatchdogTimer);
        stallWatchdogTimer = setTimeout(() => {
          if (userPaused || media.ended) return;
          if (media.readyState >= 2 && media.paused) {
            media.play().catch(() => {});
          } else if (media.readyState < 2 && media.currentTime > 0) {
            try {
              media.currentTime = media.currentTime;
            } catch (_) {}
          }
        }, 4000);
      };

      media.addEventListener('stalled', handleStallOrWait);
      media.addEventListener('waiting', handleStallOrWait);

      media.addEventListener('canplay', () => {
        const settings = getSettings();
        if (isRecovering && settings.enabled && settings.autoResume && !userPaused && media.paused) {
          media.play().catch(() => {});
        }
      });

      media.addEventListener('error', () => {
        const settings = getSettings();
        if (!settings.enabled || !settings.autoResume || userPaused) return;
        if (media.error && media.error.code === 2 /* MEDIA_ERR_NETWORK */) {
          isRecovering = true;
          const resumeAt = lastKnownTime;
          setTimeout(() => {
            if (userPaused) return;
            try {
              if (resumeAt > 0) media.currentTime = resumeAt;
              media.play().catch(() => {});
            } catch (_) {}
          }, 2000);
        }
      });
    }

    function onSettingsChanged(settings) {
      extensionEnabled = settings.enabled;
      const media = getActiveMedia();
      if (!settings.enabled || !settings.keepAlive || !media || media.paused) {
        audioEngine.setKeepAlive(false);
      } else {
        audioEngine.setKeepAlive(true);
      }
    }

    scheduleActivityLoop();
    startPromptObserver();

    return {
      attachMedia,
      setUserPaused,
      isUserPaused,
      onSettingsChanged,
      getDebugState: () => ({
        isAndroid: IS_ANDROID,
        actualHidden: actualHiddenFlag,
        userPaused,
        isRecovering,
        pauseRetryCount,
      }),
    };
  }

  ns.createResilienceController = createResilienceController;
})(typeof globalThis !== 'undefined' ? globalThis : this);
