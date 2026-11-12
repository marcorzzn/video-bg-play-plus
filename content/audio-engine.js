(function (root) {
  'use strict';

  const ns = (root.__VBGPP__ = root.__VBGPP__ || {});

  function createAudioEngine() {
    const attachedMediaMap = new WeakMap();
    const pendingInitMap = new WeakMap();
    let keepAliveCtx = null;
    let keepAliveOsc = null;
    let keepAliveActive = false;
    let lastStatus = 'native'; // 'native' | 'worklet-active' | 'scriptproc-active' | 'worklet-bypassed' | 'cors-blocked' | 'worklet-unavailable'
    let lastError = '';

    function isMediaCorsSafe(media) {
      const src = media.currentSrc || media.src || '';
      if (!src) return true;
      if (src.startsWith('blob:') || src.startsWith('data:')) return true;
      if (media.crossOrigin) return true;
      try {
        const u = new URL(src, window.location.href);
        return u.origin === window.location.origin;
      } catch (_) {
        return false;
      }
    }

    function applyNativeRates(media, mode) {
      if (!media) return;
      try {
        if (Math.abs(media.playbackRate - mode.playbackRate) > 0.001) {
          media.playbackRate = mode.playbackRate;
        }
        if ('preservesPitch' in media) {
          media.preservesPitch = mode.preservesPitch;
        }
        if ('mozPreservesPitch' in media) {
          media.mozPreservesPitch = mode.preservesPitch;
        }
      } catch (_) {}
    }

    function createScriptProcessorPitchNode(ctx) {
      if (typeof ctx.createScriptProcessor !== 'function' || !ns.GranularPitchShifter) {
        return null;
      }
      const shifter = new ns.GranularPitchShifter(2);
      const proc = ctx.createScriptProcessor(2048, 2, 2);
      proc.onaudioprocess = (event) => {
        const inBuf = event.inputBuffer;
        const outBuf = event.outputBuffer;
        const chCount = Math.min(inBuf.numberOfChannels, outBuf.numberOfChannels);
        const inChannels = [];
        const outChannels = [];
        for (let c = 0; c < chCount; c++) {
          inChannels.push(inBuf.getChannelData(c));
          outChannels.push(outBuf.getChannelData(c));
        }
        shifter.processBlock(inChannels, outChannels);
      };
      return { node: proc, shifter, kind: 'scriptproc' };
    }

    async function ensureProcessingChain(media) {
      let entry = attachedMediaMap.get(media);
      if (entry) return entry;
      if (pendingInitMap.has(media)) {
        return pendingInitMap.get(media);
      }

      const initPromise = (async () => {
        if (!isMediaCorsSafe(media)) {
          lastStatus = 'cors-blocked';
          lastError = '';
          return null;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          lastStatus = 'worklet-unavailable';
          lastError = 'AudioContext non supportato';
          return null;
        }

        const ctx = new AudioCtx();
        let source = null;
        try {
          source = ctx.createMediaElementSource(media);
        } catch (err) {
          lastStatus = 'worklet-unavailable';
          lastError = err && err.message ? err.message : 'createMediaElementSource fallito';
          try {
            await ctx.close();
          } catch (_) {}
          return null;
        }

        // Primary: AudioWorkletNode (off-main-thread)
        if (ctx.audioWorklet && typeof ctx.audioWorklet.addModule === 'function') {
          try {
            const workletUrl = browser.runtime.getURL('content/pitch-worklet.js');
            await ctx.audioWorklet.addModule(workletUrl);
            const workletNode = new AudioWorkletNode(ctx, 'vbgpp-pitch-processor', {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [2],
            });
            const created = {
              ctx,
              source,
              processorNode: workletNode,
              kind: 'worklet',
              shifter: null,
              isConnected: false,
            };
            attachedMediaMap.set(media, created);
            lastError = '';
            return created;
          } catch (workletErr) {
            // Fall through to inline ScriptProcessorNode (immune to page CSP blocking addModule)
            lastError = workletErr && workletErr.message ? workletErr.message : '';
          }
        }

        // Fallback: inline ScriptProcessorNode inside content script
        const sp = createScriptProcessorPitchNode(ctx);
        if (sp) {
          const created = {
            ctx,
            source,
            processorNode: sp.node,
            kind: 'scriptproc',
            shifter: sp.shifter,
            isConnected: false,
          };
          attachedMediaMap.set(media, created);
          lastError = '';
          return created;
        }

        lastStatus = 'worklet-unavailable';
        try {
          source.connect(ctx.destination);
        } catch (_) {}
        return null;
      })();

      pendingInitMap.set(media, initPromise);
      try {
        return await initPromise;
      } finally {
        pendingInitMap.delete(media);
      }
    }

    async function applyToMedia(media, settings) {
      if (!media) return;
      const mode = ns.core.resolvePlaybackAudioMode(settings);
      applyNativeRates(media, mode);

      const existing = attachedMediaMap.get(media);

      if (!mode.needsWorklet) {
        if (existing) {
          if (existing.shifter) {
            existing.shifter.setSemitones(0);
          }
          if (existing.isConnected) {
            try {
              existing.source.disconnect();
              existing.processorNode.disconnect();
              existing.source.connect(existing.ctx.destination);
              existing.isConnected = false;
            } catch (_) {}
          }
          lastStatus = 'worklet-bypassed';
        } else {
          lastStatus = 'native';
        }
        return;
      }

      const entry = existing || (await ensureProcessingChain(media));
      if (!entry) return;

      if (entry.ctx.state === 'suspended' && !media.paused) {
        entry.ctx.resume().catch(() => {});
      }

      if (!entry.isConnected) {
        try {
          entry.source.disconnect();
        } catch (_) {}
        entry.source.connect(entry.processorNode);
        entry.processorNode.connect(entry.ctx.destination);
        entry.isConnected = true;
      }

      try {
        if (entry.kind === 'worklet') {
          const param = entry.processorNode.parameters && entry.processorNode.parameters.get('semitones');
          if (param) {
            param.setValueAtTime(mode.workletSemitones, entry.ctx.currentTime);
          }
          entry.processorNode.port.postMessage({ semitones: mode.workletSemitones });
          lastStatus = 'worklet-active';
        } else if (entry.kind === 'scriptproc' && entry.shifter) {
          entry.shifter.setSemitones(mode.workletSemitones);
          lastStatus = 'scriptproc-active';
        }
      } catch (err) {
        lastStatus = 'worklet-unavailable';
        lastError = err && err.message ? err.message : '';
      }
    }

    function resumeContextIfNeeded(media) {
      const entry = media ? attachedMediaMap.get(media) : null;
      if (entry && entry.ctx && entry.ctx.state === 'suspended') {
        entry.ctx.resume().catch(() => {});
      }
    }

    function setKeepAlive(active) {
      if (active === keepAliveActive) return;
      keepAliveActive = Boolean(active);

      if (keepAliveActive) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          if (!keepAliveCtx) {
            keepAliveCtx = new AudioCtx();
          }
          if (keepAliveCtx.state === 'suspended') {
            keepAliveCtx.resume().catch(() => {});
          }
          if (!keepAliveOsc) {
            const osc = keepAliveCtx.createOscillator();
            const gain = keepAliveCtx.createGain();
            osc.frequency.value = 1;
            gain.gain.value = 0.00001;
            osc.connect(gain);
            gain.connect(keepAliveCtx.destination);
            osc.start();
            keepAliveOsc = { osc, gain };
          }
        } catch (_) {}
      } else {
        if (keepAliveOsc) {
          try {
            keepAliveOsc.osc.stop();
            keepAliveOsc.osc.disconnect();
            keepAliveOsc.gain.disconnect();
          } catch (_) {}
          keepAliveOsc = null;
        }
        if (keepAliveCtx && keepAliveCtx.state === 'running') {
          keepAliveCtx.suspend().catch(() => {});
        }
      }
    }

    function getStatus() {
      return lastStatus;
    }

    function getError() {
      return lastError;
    }

    return {
      applyToMedia,
      resumeContextIfNeeded,
      setKeepAlive,
      getStatus,
      getError,
    };
  }

  ns.createAudioEngine = createAudioEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
