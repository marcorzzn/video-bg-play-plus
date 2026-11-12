(function (root) {
  'use strict';

  const ns = (root.__VBGPP__ = root.__VBGPP__ || {});
  const IS_ANDROID = navigator.userAgent.indexOf('Android') > -1;

  function createQuickPill({ getSettings, updateSetting, mediaSession, getActiveMedia, audioEngine }) {
    let host = null;
    let shadow = null;
    let expanded = false;
    let refs = null;

    function shouldShow() {
      const s = getSettings();
      if (!s.enabled) return false;
      if (s.quickPillMode === 'off') return false;
      if (s.quickPillMode === 'on') return Boolean(getActiveMedia());
      return IS_ANDROID && Boolean(getActiveMedia());
    }

    function ensureMounted() {
      if (host || !document.body) return;
      host = document.createElement('div');
      host.id = 'vbgpp-quick-pill-host';
      host.style.cssText =
        'position:fixed;bottom:72px;right:10px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;';
      shadow = host.attachShadow({ mode: 'closed' });

      const style = document.createElement('style');
      style.textContent = `
        :host {
          color-scheme: light dark;
          --bg-surface: rgba(255, 255, 255, 0.94);
          --bg-subtle: #f0f0f4;
          --bg-hover: #e0e0e6;
          --border-subtle: rgba(21, 20, 26, 0.14);
          --text-primary: #15141a;
          --text-secondary: #5b5b66;
          --accent: #0060df;
          --accent-soft: rgba(0, 96, 223, 0.12);
          --accent-text: #0060df;
          --on-accent: #ffffff;
          --warn-text: #a44100;
          --shadow: 0 6px 20px rgba(21, 20, 26, 0.18);
        }
        @media (prefers-color-scheme: dark) {
          :host {
            --bg-surface: rgba(28, 27, 34, 0.94);
            --bg-subtle: #2b2a33;
            --bg-hover: #3a3944;
            --border-subtle: rgba(251, 251, 254, 0.14);
            --text-primary: #fbfbfe;
            --text-secondary: #cfcfd8;
            --accent: #00ddff;
            --accent-soft: rgba(0, 221, 255, 0.16);
            --accent-text: #00ddff;
            --on-accent: #15141a;
            --warn-text: #ffbd4f;
            --shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
          }
        }
        * { box-sizing: border-box; user-select: none; -webkit-tap-highlight-color: transparent; }
        .pill-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 7px 12px; border-radius: 9999px;
          background: var(--bg-surface); color: var(--text-primary);
          border: 1px solid var(--border-subtle);
          font-size: 12px; font-weight: 600; cursor: pointer;
          backdrop-filter: blur(12px); box-shadow: var(--shadow);
          font-variant-numeric: tabular-nums;
        }
        .pill-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--accent); flex-shrink: 0;
        }
        .panel {
          width: 276px; padding: 12px; border-radius: 10px;
          background: var(--bg-surface); color: var(--text-primary);
          border: 1px solid var(--border-subtle);
          backdrop-filter: blur(16px); box-shadow: var(--shadow);
        }
        .hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .title { font-size: 12px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
        .close {
          display: inline-flex; align-items: center; justify-content: center;
          background: var(--bg-subtle); color: var(--text-primary);
          border: 1px solid var(--border-subtle);
          border-radius: 4px; width: 24px; height: 24px; font-size: 12px; cursor: pointer;
        }
        .row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-bottom: 9px; }
        .btn {
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
          height: 38px; border-radius: 6px; border: 1px solid var(--border-subtle);
          background: var(--bg-subtle); color: var(--text-primary);
          font-size: 10px; font-weight: 600; cursor: pointer; padding: 0;
        }
        .btn svg { width: 14px; height: 14px; display: block; }
        .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
        .btn.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-text); }
        .link-btn {
          width: 100%; height: 28px; margin-bottom: 6px; border-radius: 6px;
          border: 1px solid var(--border-subtle); background: var(--bg-subtle);
          color: var(--text-primary); font-size: 11px; font-weight: 600; cursor: pointer;
        }
        .link-btn.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-text); }
        .ctrl { margin-top: 6px; }
        .ctrl-top { display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 3px; }
        .ctrl-top strong { font-variant-numeric: tabular-nums; }
        .reset {
          background: none; border: 0; border-radius: 4px; color: var(--accent-text);
          font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 6px;
        }
        input[type="range"] { width: 100%; accent-color: var(--accent); cursor: pointer; margin: 0; }
        .note { font-size: 10px; color: var(--warn-text); margin-top: 6px; }
        .note:empty { display: none; }
      `;

      const container = document.createElement('div');
      container.innerHTML = `
        <button class="pill-btn" data-el="pill"><span class="pill-dot"></span><span data-el="pillText"></span></button>
        <div class="panel" data-el="panel" style="display:none;">
          <div class="hdr">
            <span class="title">Video BG Play Plus</span>
            <button class="close" data-act="collapse" aria-label="Chiudi">✕</button>
          </div>
          <div class="row">
            <button class="btn" data-act="restart" title="Ricomincia">
              <svg viewBox="0 0 16 16"><path d="M3.5 3v10M12.5 3.5 6 8l6.5 4.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="btn" data-act="back" title="-5s">-5s</button>
            <button class="btn primary" data-act="playpause" title="Play/Pausa">
              <svg viewBox="0 0 16 16"><path data-el="ppPath" d="M4.5 3.2 12.5 8l-8 4.8z" fill="currentColor"/></svg>
            </button>
            <button class="btn" data-act="stop" title="Stop">
              <svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor"/></svg>
            </button>
            <button class="btn" data-act="fwd" title="+5s">+5s</button>
            <button class="btn" data-act="loop" data-el="loopBtn" title="Loop">
              <svg viewBox="0 0 16 16"><path d="M11.5 2.5 14 5l-2.5 2.5M4.5 13.5 2 11l2.5-2.5M13.5 5H5.5A3 3 0 0 0 2.5 8v.5M2.5 11h8a3 3 0 0 0 3-3v-.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <button class="link-btn" data-act="toggleLink" data-el="linkBtn"></button>
          <button class="link-btn" data-act="cycleNotif" data-el="notifBtn"></button>
          <div class="ctrl">
            <div class="ctrl-top">
              <span>Velocità <strong data-el="speedVal">1.00x</strong></span>
              <button class="reset" data-act="resetSpeed">Ripristina</button>
            </div>
            <input type="range" min="0.25" max="4" step="0.01" data-el="speedRange" />
          </div>
          <div class="ctrl">
            <div class="ctrl-top">
              <span>Tonalità <strong data-el="pitchVal">0.0 st</strong></span>
              <button class="reset" data-act="resetPitch">Ripristina</button>
            </div>
            <input type="range" min="-24" max="24" step="0.1" data-el="pitchRange" />
          </div>
          <div class="note" data-el="note"></div>
        </div>
      `;

      shadow.appendChild(style);
      shadow.appendChild(container);
      document.body.appendChild(host);

      const q = (name) => shadow.querySelector(`[data-el="${name}"]`);
      refs = {
        pill: q('pill'),
        pillText: q('pillText'),
        panel: q('panel'),
        ppPath: q('ppPath'),
        loopBtn: q('loopBtn'),
        linkBtn: q('linkBtn'),
        notifBtn: q('notifBtn'),
        speedVal: q('speedVal'),
        speedRange: q('speedRange'),
        pitchVal: q('pitchVal'),
        pitchRange: q('pitchRange'),
        note: q('note'),
      };

      refs.pill.addEventListener('click', () => {
        expanded = true;
        render();
      });

      shadow.addEventListener('click', (e) => {
        const target = e.target.closest('[data-act]');
        if (!target) return;
        const act = target.dataset.act;
        const s = getSettings();
        if (act === 'collapse') {
          expanded = false;
          render();
        } else if (act === 'restart') {
          mediaSession.restartTrack(true);
        } else if (act === 'back') {
          mediaSession.seekBy(-(s.seekStep || 5));
        } else if (act === 'fwd') {
          mediaSession.seekBy(s.seekStep || 5);
        } else if (act === 'playpause') {
          mediaSession.togglePlayPause();
        } else if (act === 'stop') {
          mediaSession.stopMedia();
        } else if (act === 'loop') {
          updateSetting('loop', !s.loop);
        } else if (act === 'toggleLink') {
          updateSetting('linkPitchAndSpeed', !s.linkPitchAndSpeed);
        } else if (act === 'cycleNotif') {
          const order = ['smart', 'seek5', 'restart_fwd5'];
          const idx = order.indexOf(s.notificationControlsMode);
          updateSetting('notificationControlsMode', order[(idx + 1) % order.length]);
        } else if (act === 'resetSpeed') {
          updateSetting('speed', 1.0);
        } else if (act === 'resetPitch') {
          updateSetting('pitchSemitones', 0.0);
        }
      });

      refs.speedRange.addEventListener('input', (e) => {
        updateSetting('speed', parseFloat(e.target.value));
      });
      refs.pitchRange.addEventListener('input', (e) => {
        updateSetting('pitchSemitones', parseFloat(e.target.value));
      });
    }

    function render() {
      const visible = shouldShow();
      if (!visible) {
        if (host) host.style.display = 'none';
        return;
      }
      ensureMounted();
      if (!host || !refs) return;
      host.style.display = 'block';

      const s = getSettings();
      const media = getActiveMedia();
      refs.pill.style.display = expanded ? 'none' : 'inline-flex';
      refs.panel.style.display = expanded ? 'block' : 'none';

      const pitchLabel = s.pitchSemitones > 0 ? `+${s.pitchSemitones.toFixed(1)}` : `${s.pitchSemitones.toFixed(1)}`;
      refs.pillText.textContent = `${s.speed.toFixed(2)}x${
        Math.abs(s.pitchSemitones) >= 0.05 ? ` · ${pitchLabel}st` : ''
      }${s.loop ? ' · Loop' : ''}`;

      const PLAY_D = 'M4.5 3.2 12.5 8l-8 4.8z';
      const PAUSE_D = 'M4 3h3v10H4zM9 3h3v10H9z';
      refs.ppPath.setAttribute('d', media && !media.paused ? PAUSE_D : PLAY_D);

      refs.loopBtn.classList.toggle('active', s.loop);
      refs.linkBtn.classList.toggle('active', s.linkPitchAndSpeed);
      refs.linkBtn.textContent = s.linkPitchAndSpeed
        ? 'Pitch & Velocità: Collegati'
        : 'Pitch & Velocità: Separati';

      const notifLabels = {
        smart: 'Notifica ⏮/⏭: Inizio / Succ.',
        seek5: 'Notifica ⏮/⏭: -5s / +5s',
        restart_fwd5: 'Notifica ⏮/⏭: Inizio / +5s',
      };
      refs.notifBtn.textContent = notifLabels[s.notificationControlsMode] || notifLabels.smart;

      refs.speedVal.textContent = `${s.speed.toFixed(2)}x`;
      refs.speedRange.value = String(s.speed);

      refs.pitchVal.textContent = `${s.pitchSemitones > 0 ? '+' : ''}${s.pitchSemitones.toFixed(1)} st`;
      refs.pitchRange.value = String(s.pitchSemitones);

      const status = audioEngine.getStatus();
      if (status === 'cors-blocked' && !s.linkPitchAndSpeed && Math.abs(s.pitchSemitones) > 0) {
        refs.note.textContent = 'Stream cross-origin: usa modalità Collegati per alterare la tonalità.';
      } else if (status === 'worklet-unavailable' && !s.linkPitchAndSpeed && Math.abs(s.pitchSemitones) > 0) {
        const errDetail = audioEngine.getError ? audioEngine.getError() : '';
        refs.note.textContent = errDetail
          ? `Pitch bloccato (${errDetail}) — usa modalità Collegati.`
          : 'Pitch indipendente non disponibile su questa pagina.';
      } else {
        refs.note.textContent = '';
      }
    }

    return { render };
  }

  ns.createQuickPill = createQuickPill;
})(typeof globalThis !== 'undefined' ? globalThis : this);
