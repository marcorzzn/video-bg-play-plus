(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.__VBGPP__ = root.__VBGPP__ || {};
    root.__VBGPP__.core = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SPEED_MIN = 0.25;
  const SPEED_MAX = 4.0;
  const PITCH_MIN = -24;
  const PITCH_MAX = 24;
  const DEFAULT_SEEK_STEP = 5;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    speed: 1.0,
    pitchSemitones: 0.0,
    linkPitchAndSpeed: false,
    linkedPitchOffset: 0.0,
    loop: false,
    seekStep: DEFAULT_SEEK_STEP,
    restartBehavior: 'smart', // 'smart' | 'always'
    notificationControlsMode: 'smart', // 'smart' | 'seek5' | 'restart_fwd5'
    autoResume: true,
    autoDismissPrompts: true,
    keepAlive: true,
    quickPillMode: 'auto', // 'auto' | 'on' | 'off'
    customSites: [],
  });

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function speedToSemitones(speed) {
    const safeSpeed = clamp(Number(speed) || 1, SPEED_MIN, SPEED_MAX);
    return 12 * Math.log2(safeSpeed);
  }

  function semitonesToSpeed(semitones) {
    const safeSemi = clamp(Number(semitones) || 0, PITCH_MIN, PITCH_MAX);
    return Math.pow(2, safeSemi / 12);
  }

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    let speed = round4(clamp(Number(src.speed ?? DEFAULT_SETTINGS.speed), SPEED_MIN, SPEED_MAX));
    const linkPitchAndSpeed = Boolean(src.linkPitchAndSpeed);
    let linkedPitchOffset = round4(
      clamp(Number(src.linkedPitchOffset ?? DEFAULT_SETTINGS.linkedPitchOffset), PITCH_MIN, PITCH_MAX)
    );
    let pitchSemitones = round4(
      clamp(Number(src.pitchSemitones ?? DEFAULT_SETTINGS.pitchSemitones), PITCH_MIN, PITCH_MAX)
    );

    if (linkPitchAndSpeed) {
      const rawPitch = speedToSemitones(speed) + linkedPitchOffset;
      if (rawPitch < PITCH_MIN || rawPitch > PITCH_MAX) {
        pitchSemitones = round4(clamp(rawPitch, PITCH_MIN, PITCH_MAX));
        speed = round4(clamp(semitonesToSpeed(pitchSemitones - linkedPitchOffset), SPEED_MIN, SPEED_MAX));
      } else {
        pitchSemitones = round4(rawPitch);
      }
    } else {
      linkedPitchOffset = 0;
    }

    const seekStep = clamp(Math.round(Number(src.seekStep ?? DEFAULT_SEEK_STEP)), 1, 60);
    const restartBehavior = src.restartBehavior === 'always' ? 'always' : 'smart';
    const notificationControlsMode =
      src.notificationControlsMode === 'seek5' || src.notificationControlsMode === 'restart_fwd5'
        ? src.notificationControlsMode
        : 'smart';
    const quickPillMode =
      src.quickPillMode === 'on' || src.quickPillMode === 'off' ? src.quickPillMode : 'auto';
    const customSites = Array.isArray(src.customSites)
      ? Array.from(new Set(src.customSites.filter((s) => typeof s === 'string' && s.length > 0)))
      : [];

    return {
      enabled: src.enabled !== false,
      speed,
      pitchSemitones,
      linkPitchAndSpeed,
      linkedPitchOffset,
      loop: Boolean(src.loop),
      seekStep,
      restartBehavior,
      notificationControlsMode,
      autoResume: src.autoResume !== false,
      autoDismissPrompts: src.autoDismissPrompts !== false,
      keepAlive: src.keepAlive !== false,
      quickPillMode,
      customSites,
    };
  }

  function updateSpeedOrPitch(current, changedField, rawValue) {
    const next = normalizeSettings(current);
    const value = Number(rawValue);
    if (!Number.isFinite(value) && changedField !== 'linkPitchAndSpeed') return next;

    if (changedField === 'speed') {
      if (next.linkPitchAndSpeed) {
        const minSpeedForPitch = Math.max(SPEED_MIN, semitonesToSpeed(PITCH_MIN - next.linkedPitchOffset));
        const maxSpeedForPitch = Math.min(SPEED_MAX, semitonesToSpeed(PITCH_MAX - next.linkedPitchOffset));
        next.speed = round4(clamp(value, minSpeedForPitch, maxSpeedForPitch));
        next.pitchSemitones = round4(
          clamp(speedToSemitones(next.speed) + next.linkedPitchOffset, PITCH_MIN, PITCH_MAX)
        );
      } else {
        next.speed = round4(clamp(value, SPEED_MIN, SPEED_MAX));
      }
    } else if (changedField === 'pitchSemitones') {
      if (next.linkPitchAndSpeed) {
        const minPitchForSpeed = Math.max(PITCH_MIN, speedToSemitones(SPEED_MIN) + next.linkedPitchOffset);
        const maxPitchForSpeed = Math.min(PITCH_MAX, speedToSemitones(SPEED_MAX) + next.linkedPitchOffset);
        next.pitchSemitones = round4(clamp(value, minPitchForSpeed, maxPitchForSpeed));
        next.speed = round4(
          clamp(semitonesToSpeed(next.pitchSemitones - next.linkedPitchOffset), SPEED_MIN, SPEED_MAX)
        );
      } else {
        next.pitchSemitones = round4(clamp(value, PITCH_MIN, PITCH_MAX));
      }
    } else if (changedField === 'linkPitchAndSpeed') {
      const linked = Boolean(rawValue);
      next.linkPitchAndSpeed = linked;
      if (linked) {
        next.linkedPitchOffset = round4(next.pitchSemitones - speedToSemitones(next.speed));
      } else {
        next.linkedPitchOffset = 0;
      }
    }
    return next;
  }

  function resolvePlaybackAudioMode(state) {
    const s = normalizeSettings(state);
    if (!s.enabled) {
      return {
        playbackRate: 1.0,
        preservesPitch: true,
        workletSemitones: 0,
        needsWorklet: false,
      };
    }
    if (s.linkPitchAndSpeed) {
      const residualOffset = s.pitchSemitones - speedToSemitones(s.speed);
      const needsWorklet = Math.abs(residualOffset) >= 0.05;
      return {
        playbackRate: s.speed,
        preservesPitch: false,
        workletSemitones: needsWorklet ? round4(residualOffset) : 0,
        needsWorklet,
      };
    }
    return {
      playbackRate: s.speed,
      preservesPitch: true,
      workletSemitones: s.pitchSemitones,
      needsWorklet: Math.abs(s.pitchSemitones) >= 0.01,
    };
  }

  function detectSite(hostname) {
    const host = String(hostname || '').toLowerCase();
    const isYouTube = /(?:^|\.)youtube\.com$/.test(host) || /(?:^|\.)youtube-nocookie\.com$/.test(host);
    const isMobileYouTube = host === 'm.youtube.com';
    const isYouTubeMusic = host === 'music.youtube.com';
    const isDesktopYouTube = isYouTube && !isMobileYouTube && !isYouTubeMusic;
    const isVimeo = /(?:^|\.)vimeo\.com$/.test(host);
    return {
      isYouTube,
      isMobileYouTube,
      isYouTubeMusic,
      isDesktopYouTube,
      isVimeo,
    };
  }

  function originToMatchPattern(urlStr) {
    try {
      const u = new URL(urlStr);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return `${u.protocol}//${u.host}/*`;
    } catch (_) {
      return null;
    }
  }

  function isBuiltinSupportedUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      const site = detectSite(u.hostname);
      return site.isYouTube || site.isVimeo;
    } catch (_) {
      return false;
    }
  }

  function computeSeekTarget(currentTime, duration, delta) {
    const cur = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    const target = Math.max(0, cur + (Number(delta) || 0));
    if (Number.isFinite(duration) && duration > 0) {
      return Math.min(duration, target);
    }
    return target;
  }

  function decidePreviousTrackAction({
    currentTime = 0,
    now = 0,
    lastPrevTapAt = 0,
    restartBehavior = 'smart',
    hasNativePrev = false,
  }) {
    if (restartBehavior === 'always' || !hasNativePrev) {
      return { action: 'restart', lastPrevTapAt: now };
    }
    if (currentTime > 3) {
      return { action: 'restart', lastPrevTapAt: now };
    }
    if (lastPrevTapAt > 0 && now - lastPrevTapAt <= 2500) {
      return { action: 'previous', lastPrevTapAt: 0 };
    }
    return { action: 'restart', lastPrevTapAt: now };
  }

  function shouldAutoResumePause({
    enabled = true,
    autoResume = true,
    userPaused = false,
    ended = false,
    isHidden = false,
    recentlyHidden = false,
    retryCount = 0,
    maxRetries = 5,
  }) {
    if (!enabled || !autoResume) return false;
    if (userPaused || ended) return false;
    if (!isHidden && !recentlyHidden) return false;
    return retryCount < maxRetries;
  }

  return {
    SPEED_MIN,
    SPEED_MAX,
    PITCH_MIN,
    PITCH_MAX,
    DEFAULT_SEEK_STEP,
    DEFAULT_SETTINGS,
    clamp,
    round4,
    speedToSemitones,
    semitonesToSpeed,
    normalizeSettings,
    updateSpeedOrPitch,
    resolvePlaybackAudioMode,
    detectSite,
    originToMatchPattern,
    isBuiltinSupportedUrl,
    computeSeekTarget,
    decidePreviousTrackAction,
    shouldAutoResumePause,
  };
});

