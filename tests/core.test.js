'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../content/core-logic.js');
const { GranularPitchShifter } = require('../content/pitch-worklet.js');

test('normalizeSettings applies defaults and clamps invalid values', () => {
  const s = core.normalizeSettings({
    speed: 99,
    pitchSemitones: -40,
    seekStep: 0,
    restartBehavior: 'invalid',
    notificationControlsMode: 'bogus',
    quickPillMode: 'bogus',
  });
  assert.equal(s.speed, 4.0);
  assert.equal(s.pitchSemitones, -24);
  assert.equal(s.seekStep, 1);
  assert.equal(s.restartBehavior, 'smart');
  assert.equal(s.notificationControlsMode, 'smart');
  assert.equal(s.quickPillMode, 'auto');
  assert.equal(s.enabled, true);

  assert.equal(core.normalizeSettings({ notificationControlsMode: 'seek5' }).notificationControlsMode, 'seek5');
  assert.equal(
    core.normalizeSettings({ notificationControlsMode: 'restart_fwd5' }).notificationControlsMode,
    'restart_fwd5'
  );
});

test('linked mode synchronizes speed and pitch semitones with exact correlation', () => {
  let state = core.normalizeSettings({ linkPitchAndSpeed: true, speed: 1.0 });
  state = core.updateSpeedOrPitch(state, 'speed', 2.0);
  assert.equal(state.speed, 2.0);
  assert.equal(state.pitchSemitones, 12);

  state = core.updateSpeedOrPitch(state, 'speed', 4.0);
  assert.equal(state.speed, 4.0);
  assert.equal(state.pitchSemitones, 24);

  state = core.updateSpeedOrPitch(state, 'pitchSemitones', -12);
  assert.equal(state.pitchSemitones, -12);
  assert.equal(state.speed, 0.5);

  state = core.updateSpeedOrPitch(state, 'pitchSemitones', 7);
  assert.ok(Math.abs(state.speed - Math.pow(2, 7 / 12)) < 0.0002);
});

test('unlinked mode keeps speed and pitch independent', () => {
  let state = core.normalizeSettings({ linkPitchAndSpeed: false, speed: 1.5, pitchSemitones: 3 });
  state = core.updateSpeedOrPitch(state, 'speed', 1.25);
  assert.equal(state.speed, 1.25);
  assert.equal(state.pitchSemitones, 3);

  state = core.updateSpeedOrPitch(state, 'pitchSemitones', -4);
  assert.equal(state.speed, 1.25);
  assert.equal(state.pitchSemitones, -4);
});

test('toggling linkPitchAndSpeed on preserves relative transposition offset', () => {
  const state = core.normalizeSettings({ linkPitchAndSpeed: false, speed: 1.0, pitchSemitones: 5 });
  let linked = core.updateSpeedOrPitch(state, 'linkPitchAndSpeed', true);
  assert.equal(linked.linkPitchAndSpeed, true);
  assert.equal(linked.speed, 1.0);
  assert.equal(linked.pitchSemitones, 5);
  assert.equal(linked.linkedPitchOffset, 5);

  // Doubling speed shifts pitch by +12 semitones from the locked +5 offset -> +17
  linked = core.updateSpeedOrPitch(linked, 'speed', 2.0);
  assert.equal(linked.speed, 2.0);
  assert.equal(linked.pitchSemitones, 17);

  const mode = core.resolvePlaybackAudioMode(linked);
  assert.equal(mode.playbackRate, 2.0);
  assert.equal(mode.preservesPitch, false);
  assert.equal(mode.workletSemitones, 5);
  assert.equal(mode.needsWorklet, true);
});

test('resolvePlaybackAudioMode chooses native vs worklet correctly', () => {
  assert.deepEqual(
    core.resolvePlaybackAudioMode({ enabled: true, linkPitchAndSpeed: true, speed: 1.5, pitchSemitones: 7 }),
    { playbackRate: 1.5, preservesPitch: false, workletSemitones: 0, needsWorklet: false }
  );

  assert.deepEqual(
    core.resolvePlaybackAudioMode({ enabled: true, linkPitchAndSpeed: false, speed: 1.5, pitchSemitones: 0 }),
    { playbackRate: 1.5, preservesPitch: true, workletSemitones: 0, needsWorklet: false }
  );

  assert.deepEqual(
    core.resolvePlaybackAudioMode({ enabled: true, linkPitchAndSpeed: false, speed: 1.5, pitchSemitones: -3.5 }),
    { playbackRate: 1.5, preservesPitch: true, workletSemitones: -3.5, needsWorklet: true }
  );

  assert.deepEqual(
    core.resolvePlaybackAudioMode({ enabled: false, linkPitchAndSpeed: false, speed: 2.0, pitchSemitones: 5 }),
    { playbackRate: 1.0, preservesPitch: true, workletSemitones: 0, needsWorklet: false }
  );
});

test('site detection and match patterns work for built-in and custom URLs', () => {
  const yt = core.detectSite('m.youtube.com');
  assert.equal(yt.isYouTube, true);
  assert.equal(yt.isMobileYouTube, true);
  assert.equal(yt.isDesktopYouTube, false);

  const ytm = core.detectSite('music.youtube.com');
  assert.equal(ytm.isYouTube, true);
  assert.equal(ytm.isYouTubeMusic, true);
  assert.equal(ytm.isDesktopYouTube, false);

  assert.equal(core.isBuiltinSupportedUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(core.isBuiltinSupportedUrl('https://vimeo.com/12345'), true);
  assert.equal(core.isBuiltinSupportedUrl('https://soundcloud.com/artist/track'), false);
  assert.equal(core.originToMatchPattern('https://soundcloud.com/artist/track'), 'https://soundcloud.com/*');
  assert.equal(core.originToMatchPattern('about:config'), null);
});

test('computeSeekTarget clamps cleanly for -5s and +5s', () => {
  assert.equal(core.computeSeekTarget(2, 100, -5), 0);
  assert.equal(core.computeSeekTarget(30, 100, -5), 25);
  assert.equal(core.computeSeekTarget(98, 100, 5), 100);
  assert.equal(core.computeSeekTarget(10, NaN, 5), 15);
});

test('decidePreviousTrackAction supports smart restart and double-tap previous', () => {
  // > 3s always restarts
  let res = core.decidePreviousTrackAction({
    currentTime: 12,
    now: 1000,
    lastPrevTapAt: 900,
    restartBehavior: 'smart',
    hasNativePrev: true,
  });
  assert.equal(res.action, 'restart');

  // <= 3s first tap restarts
  res = core.decidePreviousTrackAction({
    currentTime: 1.2,
    now: 5000,
    lastPrevTapAt: 0,
    restartBehavior: 'smart',
    hasNativePrev: true,
  });
  assert.equal(res.action, 'restart');
  assert.equal(res.lastPrevTapAt, 5000);

  // <= 3s second tap within 2.5s triggers previous track
  res = core.decidePreviousTrackAction({
    currentTime: 0.4,
    now: 6200,
    lastPrevTapAt: 5000,
    restartBehavior: 'smart',
    hasNativePrev: true,
  });
  assert.equal(res.action, 'previous');

  // always mode never triggers previous
  res = core.decidePreviousTrackAction({
    currentTime: 0.2,
    now: 6200,
    lastPrevTapAt: 5000,
    restartBehavior: 'always',
    hasNativePrev: true,
  });
  assert.equal(res.action, 'restart');
});

test('shouldAutoResumePause respects user intent, hidden state, and retry limits', () => {
  assert.equal(
    core.shouldAutoResumePause({ userPaused: false, isHidden: true, retryCount: 0 }),
    true
  );
  assert.equal(
    core.shouldAutoResumePause({ userPaused: true, isHidden: true, retryCount: 0 }),
    false
  );
  assert.equal(
    core.shouldAutoResumePause({ userPaused: false, ended: true, isHidden: true, retryCount: 0 }),
    false
  );
  assert.equal(
    core.shouldAutoResumePause({ userPaused: false, isHidden: false, recentlyHidden: false, retryCount: 0 }),
    false
  );
  assert.equal(
    core.shouldAutoResumePause({ userPaused: false, isHidden: true, retryCount: 5, maxRetries: 5 }),
    false
  );
});

test('GranularPitchShifter processes sine blocks stably for pitch up and down', () => {
  for (const semitones of [-24, -12, -7, 0, 5, 12, 24]) {
    const shifter = new GranularPitchShifter(2);
    shifter.setSemitones(semitones);

    const blockSize = 128;
    const numBlocks = 140; // ~17,920 samples (> BUF_SIZE)
    let phase = 0;
    const freq = 440;
    const sr = 48000;
    let energySum = 0;
    let maxAbs = 0;

    for (let b = 0; b < numBlocks; b++) {
      const inL = new Float32Array(blockSize);
      const inR = new Float32Array(blockSize);
      const outL = new Float32Array(blockSize);
      const outR = new Float32Array(blockSize);

      for (let i = 0; i < blockSize; i++) {
        const s = 0.5 * Math.sin((2 * Math.PI * freq * phase) / sr);
        inL[i] = s;
        inR[i] = s;
        phase++;
      }

      shifter.processBlock([inL, inR], [outL, outR]);

      if (b > 60) {
        for (let i = 0; i < blockSize; i++) {
          assert.ok(Number.isFinite(outL[i]), `NaN/Inf in left output at semitones=${semitones}`);
          assert.ok(Number.isFinite(outR[i]), `NaN/Inf in right output at semitones=${semitones}`);
          maxAbs = Math.max(maxAbs, Math.abs(outL[i]), Math.abs(outR[i]));
          energySum += outL[i] * outL[i];
        }
      }
    }

    assert.ok(maxAbs <= 1.05, `Peak exceeded bounds (${maxAbs}) at semitones=${semitones}`);
    assert.ok(energySum > 10, `Output signal unexpectedly silent (${energySum}) at semitones=${semitones}`);
  }
});

