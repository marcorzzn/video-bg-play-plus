(function (globalScope) {
  'use strict';

  const BUF_SIZE = 16384;
  const BUF_MASK = BUF_SIZE - 1;
  const GRAIN_SIZE = 2048;
  const PHASE_INC = 1 / GRAIN_SIZE;
  const SEARCH_RADIUS = 64;
  const SEARCH_STEP = 4;
  const CORR_LEN = 32;
  const CORR_STEP = 2;

  const HANN_LUT = new Float32Array(GRAIN_SIZE);
  for (let i = 0; i < GRAIN_SIZE; i++) {
    HANN_LUT[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / GRAIN_SIZE));
  }

  class GranularPitchShifter {
    constructor(maxChannels = 2) {
      this.maxChannels = Math.max(1, maxChannels);
      this.buffers = [];
      for (let c = 0; c < this.maxChannels; c++) {
        this.buffers.push(new Float32Array(BUF_SIZE));
      }
      this.writeIdx = 0;
      this.targetSemitones = 0;
      this.smoothedSemitones = 0;
      this.bypass = true;

      this.phases = [0.0, 0.5];
      this.readPos = [-512, -512 - GRAIN_SIZE / 2];
    }

    ensureChannels(numChannels) {
      while (this.buffers.length < numChannels) {
        this.buffers.push(new Float32Array(BUF_SIZE));
      }
    }

    setSemitones(semitones) {
      const val = Number(semitones);
      this.targetSemitones = Number.isFinite(val) ? Math.max(-24, Math.min(24, val)) : 0;
      this.bypass = Math.abs(this.targetSemitones) < 0.01;
    }

    _computeSafeStartDelay(ratio) {
      const drift = GRAIN_SIZE * Math.max(0, ratio - 1);
      return Math.min(BUF_SIZE - GRAIN_SIZE - 512, Math.max(256, drift + 256));
    }

    _findBestReadPos(nominalPos, otherPos, minPos, maxPos) {
      const refBuf = this.buffers[0];
      let bestOffset = 0;
      let bestScore = -Infinity;

      for (let offset = -SEARCH_RADIUS; offset <= SEARCH_RADIUS; offset += SEARCH_STEP) {
        const candidate = nominalPos + offset;
        if (candidate < minPos || candidate > maxPos) continue;
        let score = 0;
        const cBase = Math.floor(candidate);
        const oBase = Math.floor(otherPos);
        for (let i = 0; i < CORR_LEN; i += CORR_STEP) {
          score += refBuf[(cBase + i) & BUF_MASK] * refBuf[(oBase + i) & BUF_MASK];
        }
        if (score > bestScore) {
          bestScore = score;
          bestOffset = offset;
        }
      }
      return nominalPos + bestOffset;
    }

    processBlock(inputChannels, outputChannels) {
      const chCount = Math.min(inputChannels.length, outputChannels.length);
      if (chCount === 0) return;
      this.ensureChannels(chCount);
      const frames = outputChannels[0].length;

      for (let i = 0; i < frames; i++) {
        this.smoothedSemitones += (this.targetSemitones - this.smoothedSemitones) * 0.004;
        const nearZero = this.bypass && Math.abs(this.smoothedSemitones) < 0.005;

        const wIdx = this.writeIdx & BUF_MASK;
        for (let c = 0; c < chCount; c++) {
          const inSample = inputChannels[c] ? inputChannels[c][i] : 0;
          this.buffers[c][wIdx] = inSample;
        }

        if (nearZero) {
          for (let c = 0; c < chCount; c++) {
            outputChannels[c][i] = inputChannels[c] ? inputChannels[c][i] : 0;
          }
          this.writeIdx++;
          continue;
        }

        const ratio = Math.pow(2, this.smoothedSemitones / 12);

        for (let g = 0; g < 2; g++) {
          this.phases[g] += PHASE_INC;
          if (this.phases[g] >= 1.0) {
            this.phases[g] -= 1.0;
            const safeDelay = this._computeSafeStartDelay(ratio);
            const nominalPos = this.writeIdx - safeDelay;
            const minPos = this.writeIdx - (BUF_SIZE - 512);
            const maxPos = this.writeIdx - safeDelay + SEARCH_RADIUS;
            const otherGrain = 1 - g;
            this.readPos[g] = this._findBestReadPos(
              nominalPos,
              this.readPos[otherGrain],
              minPos,
              Math.min(this.writeIdx - 128, maxPos)
            );
          }
        }

        const lutIdx0 = Math.min(GRAIN_SIZE - 1, Math.floor(this.phases[0] * GRAIN_SIZE));
        const lutIdx1 = Math.min(GRAIN_SIZE - 1, Math.floor(this.phases[1] * GRAIN_SIZE));
        const w0 = HANN_LUT[lutIdx0];
        const w1 = HANN_LUT[lutIdx1];
        const norm = w0 + w1 || 1;

        const p0 = this.readPos[0];
        const p0Floor = Math.floor(p0);
        const f0 = p0 - p0Floor;
        const i0a = p0Floor & BUF_MASK;
        const i0b = (p0Floor + 1) & BUF_MASK;

        const p1 = this.readPos[1];
        const p1Floor = Math.floor(p1);
        const f1 = p1 - p1Floor;
        const i1a = p1Floor & BUF_MASK;
        const i1b = (p1Floor + 1) & BUF_MASK;

        for (let c = 0; c < chCount; c++) {
          const buf = this.buffers[c];
          const s0 = buf[i0a] + f0 * (buf[i0b] - buf[i0a]);
          const s1 = buf[i1a] + f1 * (buf[i1b] - buf[i1a]);
          outputChannels[c][i] = (s0 * w0 + s1 * w1) / norm;
        }

        this.readPos[0] += ratio;
        this.readPos[1] += ratio;
        this.writeIdx++;
      }
    }
  }

  if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
    class VbgppPitchProcessor extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          {
            name: 'semitones',
            defaultValue: 0,
            minValue: -24,
            maxValue: 24,
            automationRate: 'k-rate',
          },
        ];
      }

      constructor() {
        super();
        this.shifter = new GranularPitchShifter(2);
        this.port.onmessage = (event) => {
          if (event.data && typeof event.data.semitones === 'number') {
            this.shifter.setSemitones(event.data.semitones);
          }
        };
      }

      process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output || output.length === 0) return true;
        if (!input || input.length === 0) {
          for (let c = 0; c < output.length; c++) {
            output[c].fill(0);
          }
          return true;
        }
        const paramSemi = parameters.semitones;
        if (paramSemi && paramSemi.length > 0) {
          this.shifter.setSemitones(paramSemi[0]);
        }
        this.shifter.processBlock(input, output);
        return true;
      }
    }

    registerProcessor('vbgpp-pitch-processor', VbgppPitchProcessor);
  }

  if (globalScope && typeof AudioWorkletProcessor === 'undefined') {
    globalScope.__VBGPP__ = globalScope.__VBGPP__ || {};
    globalScope.__VBGPP__.GranularPitchShifter = GranularPitchShifter;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { GranularPitchShifter, BUF_SIZE, GRAIN_SIZE };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
