(function (root) {
  'use strict';

  const ns = (root.__VBGPP__ = root.__VBGPP__ || {});

  function createMediaSessionController({ getSettings, getActiveMedia, resilience, audioEngine }) {
    let lastPrevTapAt = 0;
    let pagePrevHandler = null;
    let pageNextHandler = null;
    let hookInstalled = false;
    let positionSyncTimer = null;

    function findNativeTrackButton(direction) {
      const selectors =
        direction === 'prev'
          ? [
              'ytmusic-player-bar .previous-button',
              '.ytp-prev-button',
              'button[aria-label*="Previous" i]',
              'button[aria-label*="Precedente" i]',
            ]
          : [
              'ytmusic-player-bar .next-button',
              '.ytp-next-button',
              'button[aria-label*="Next" i]',
              'button[aria-label*="Successivo" i]',
            ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          return el;
        }
      }
      return null;
    }

    function hasNativePreviousTrack() {
      return Boolean(pagePrevHandler || findNativeTrackButton('prev'));
    }

    function triggerNativePrev() {
      if (typeof pagePrevHandler === 'function') {
        try {
          pagePrevHandler({ action: 'previoustrack' });
          return true;
        } catch (_) {}
      }
      const btn = findNativeTrackButton('prev');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }

    function triggerNativeNext() {
      if (typeof pageNextHandler === 'function') {
        try {
          pageNextHandler({ action: 'nexttrack' });
          return true;
        } catch (_) {}
      }
      const btn = findNativeTrackButton('next');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }

    function updatePositionState(media) {
      if (!media || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) {
        return;
      }
      const duration = media.duration;
      const position = media.currentTime;
      const playbackRate = media.playbackRate;
      if (
        Number.isFinite(duration) &&
        duration > 0 &&
        Number.isFinite(position) &&
        position >= 0 &&
        Number.isFinite(playbackRate) &&
        playbackRate > 0
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate,
            position: Math.min(duration, position),
          });
        } catch (_) {}
      }
    }

    function playMedia() {
      const media = getActiveMedia();
      if (!media) return;
      resilience.setUserPaused(false);
      audioEngine.resumeContextIfNeeded(media);
      media.play().catch(() => {});
    }

    function pauseMedia() {
      const media = getActiveMedia();
      if (!media) return;
      resilience.setUserPaused(true);
      media.pause();
    }

    function togglePlayPause() {
      const media = getActiveMedia();
      if (!media) return;
      if (media.paused) {
        playMedia();
      } else {
        pauseMedia();
      }
    }

    function stopMedia() {
      const media = getActiveMedia();
      if (!media) return;
      resilience.setUserPaused(true);
      media.pause();
      try {
        media.currentTime = 0;
      } catch (_) {}
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.playbackState = 'none';
        } catch (_) {}
      }
      updatePositionState(media);
    }

    function restartTrack(autoplayIfPaused = true) {
      const media = getActiveMedia();
      if (!media) return;
      try {
        media.currentTime = 0;
      } catch (_) {}
      if (autoplayIfPaused && media.paused) {
        playMedia();
      } else {
        updatePositionState(media);
      }
    }

    function seekBy(deltaSeconds) {
      const media = getActiveMedia();
      if (!media) return;
      const target = ns.core.computeSeekTarget(media.currentTime, media.duration, deltaSeconds);
      try {
        media.currentTime = target;
      } catch (_) {}
      updatePositionState(media);
    }

    function seekTo(timeSeconds) {
      const media = getActiveMedia();
      if (!media || !Number.isFinite(timeSeconds)) return;
      const target = ns.core.computeSeekTarget(0, media.duration, timeSeconds);
      try {
        media.currentTime = target;
      } catch (_) {}
      updatePositionState(media);
    }

    function handlePreviousTrack() {
      const media = getActiveMedia();
      if (!media) return;
      const settings = getSettings();
      const step = settings.seekStep || 5;
      if (settings.notificationControlsMode === 'seek5') {
        seekBy(-step);
        return;
      }
      if (settings.notificationControlsMode === 'restart_fwd5') {
        restartTrack(false);
        return;
      }

      const now = Date.now();
      const decision = ns.core.decidePreviousTrackAction({
        currentTime: media.currentTime || 0,
        now,
        lastPrevTapAt,
        restartBehavior: settings.restartBehavior,
        hasNativePrev: hasNativePreviousTrack(),
      });
      lastPrevTapAt = decision.lastPrevTapAt;

      if (decision.action === 'previous') {
        if (!triggerNativePrev()) {
          restartTrack(false);
        }
      } else {
        restartTrack(false);
      }
    }

    function handleNextTrack() {
      const settings = getSettings();
      const step = settings.seekStep || 5;
      if (
        settings.notificationControlsMode === 'seek5' ||
        settings.notificationControlsMode === 'restart_fwd5'
      ) {
        seekBy(step);
        return;
      }
      triggerNativeNext();
    }

    function installPageMediaSessionHook() {
      if (hookInstalled || typeof exportFunction !== 'function') return;
      try {
        const pageNav = window.wrappedJSObject && window.wrappedJSObject.navigator;
        const pageMs = pageNav && pageNav.mediaSession;
        if (!pageMs || typeof pageMs.setActionHandler !== 'function') return;

        const origSetActionHandler = pageMs.setActionHandler.bind(pageMs);
        const wrappedSetActionHandler = exportFunction(function (action, handler) {
          if (action === 'previoustrack') {
            pagePrevHandler = handler || null;
            return;
          }
          if (action === 'nexttrack') {
            pageNextHandler = handler || null;
            return;
          }
          if (
            action === 'play' ||
            action === 'pause' ||
            action === 'stop' ||
            action === 'seekbackward' ||
            action === 'seekforward' ||
            action === 'seekto'
          ) {
            // Keep our enhanced handlers in charge when enabled
            if (getSettings().enabled) {
              return;
            }
          }
          return origSetActionHandler(action, handler);
        }, pageMs);

        Object.defineProperty(pageMs, 'setActionHandler', {
          value: wrappedSetActionHandler,
          configurable: true,
          writable: true,
        });
        hookInstalled = true;
      } catch (_) {}
    }

    function registerHandlers() {
      if (!('mediaSession' in navigator)) return;
      const settings = getSettings();
      if (!settings.enabled) return;

      const ms = navigator.mediaSession;
      const safeSet = (action, fn) => {
        try {
          ms.setActionHandler(action, fn);
        } catch (_) {}
      };

      safeSet('play', () => playMedia());
      safeSet('pause', () => pauseMedia());
      safeSet('stop', () => stopMedia());
      safeSet('seekbackward', (details) => {
        const step = getSettings().seekStep || 5;
        const offset =
          details && typeof details.seekOffset === 'number' && details.seekOffset > 0 && details.seekOffset !== 10
            ? details.seekOffset
            : step;
        seekBy(-offset);
      });
      safeSet('seekforward', (details) => {
        const step = getSettings().seekStep || 5;
        const offset =
          details && typeof details.seekOffset === 'number' && details.seekOffset > 0 && details.seekOffset !== 10
            ? details.seekOffset
            : step;
        seekBy(offset);
      });
      safeSet('seekto', (details) => {
        if (details && typeof details.seekTime === 'number') {
          seekTo(details.seekTime);
        }
      });
      safeSet('previoustrack', () => handlePreviousTrack());
      safeSet('nexttrack', () => handleNextTrack());
    }

    function syncLoopAttribute(media) {
      if (!media) return;
      const settings = getSettings();
      const desired = Boolean(settings.enabled && settings.loop);
      if (media.loop !== desired) {
        media.loop = desired;
      }
    }

    function attachMedia(media) {
      if (!media || media.__vbgppMediaSessionBound) return;
      media.__vbgppMediaSessionBound = true;

      installPageMediaSessionHook();
      syncLoopAttribute(media);
      registerHandlers();

      const refresh = () => {
        syncLoopAttribute(media);
        updatePositionState(media);
        if ('mediaSession' in navigator) {
          try {
            navigator.mediaSession.playbackState = media.paused ? 'paused' : 'playing';
          } catch (_) {}
        }
      };

      media.addEventListener('loadedmetadata', () => {
        refresh();
        setTimeout(registerHandlers, 150);
        setTimeout(registerHandlers, 800);
      });
      media.addEventListener('play', () => {
        refresh();
        setTimeout(registerHandlers, 150);
      });
      media.addEventListener('pause', refresh);
      media.addEventListener('seeked', refresh);
      media.addEventListener('ratechange', refresh);
      media.addEventListener('durationchange', refresh);

      media.addEventListener('timeupdate', () => {
        const settings = getSettings();
        if (settings.enabled && settings.loop && !media.loop) {
          media.loop = true;
        }
      });

      // Capture-phase guard for loop: prevents SPA players (e.g. YouTube) from advancing playlist on ended
      media.addEventListener(
        'ended',
        (evt) => {
          const settings = getSettings();
          if (settings.enabled && settings.loop) {
            evt.stopImmediatePropagation();
            try {
              media.currentTime = 0;
              media.play().catch(() => {});
            } catch (_) {}
          }
        },
        true
      );

      if (!positionSyncTimer) {
        window.addEventListener('visibilitychange', () => {
          registerHandlers();
          const active = getActiveMedia();
          if (active) updatePositionState(active);
        }, true);

        positionSyncTimer = setInterval(() => {
          const active = getActiveMedia();
          if (active && !active.paused) {
            updatePositionState(active);
          }
        }, 1000);
      }
    }

    function onSettingsChanged() {
      const media = getActiveMedia();
      if (media) {
        syncLoopAttribute(media);
        updatePositionState(media);
      }
      registerHandlers();
    }

    return {
      attachMedia,
      onSettingsChanged,
      playMedia,
      pauseMedia,
      togglePlayPause,
      stopMedia,
      restartTrack,
      seekBy,
      seekTo,
      registerHandlers,
    };
  }

  ns.createMediaSessionController = createMediaSessionController;
})(typeof globalThis !== 'undefined' ? globalThis : this);

