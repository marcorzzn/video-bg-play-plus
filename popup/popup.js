'use strict';

(function () {
  const core = window.__VBGPP__.core;
  let settings = core.normalizeSettings(core.DEFAULT_SETTINGS);
  let activeTab = null;
  let tabState = null;

  const el = {
    enabledToggle: document.getElementById('enabledToggle'),
    mediaTitle: document.getElementById('mediaTitle'),
    timeDisplay: document.getElementById('timeDisplay'),
    siteBanner: document.getElementById('siteBanner'),
    siteLabel: document.getElementById('siteLabel'),
    siteActionBtn: document.getElementById('siteActionBtn'),
    btnRestart: document.getElementById('btnRestart'),
    btnBack: document.getElementById('btnBack'),
    btnPlayPause: document.getElementById('btnPlayPause'),
    playPausePath: document.getElementById('playPausePath'),
    playPauseLabel: document.getElementById('playPauseLabel'),
    btnStop: document.getElementById('btnStop'),
    btnFwd: document.getElementById('btnFwd'),
    btnLoop: document.getElementById('btnLoop'),
    btnLinkMode: document.getElementById('btnLinkMode'),
    speedValue: document.getElementById('speedValue'),
    speedRange: document.getElementById('speedRange'),
    btnResetSpeed: document.getElementById('btnResetSpeed'),
    speedPresets: document.getElementById('speedPresets'),
    pitchValue: document.getElementById('pitchValue'),
    pitchRange: document.getElementById('pitchRange'),
    btnResetPitch: document.getElementById('btnResetPitch'),
    pitchPresets: document.getElementById('pitchPresets'),
    audioStatusNote: document.getElementById('audioStatusNote'),
    chkAutoResume: document.getElementById('chkAutoResume'),
    chkAutoDismiss: document.getElementById('chkAutoDismiss'),
    chkKeepAlive: document.getElementById('chkKeepAlive'),
    selNotificationMode: document.getElementById('selNotificationMode'),
    selRestartBehavior: document.getElementById('selRestartBehavior'),
    selQuickPill: document.getElementById('selQuickPill'),
  };

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '--:--';
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function saveSettings() {
    browser.storage.local.set({ vbgppSettings: settings }).catch(() => {});
  }

  function updateSetting(key, value) {
    if (key === 'speed' || key === 'pitchSemitones' || key === 'linkPitchAndSpeed') {
      settings = core.updateSpeedOrPitch(settings, key, value);
    } else {
      settings = core.normalizeSettings({ ...settings, [key]: value });
    }
    render();
    saveSettings();
  }

  async function sendTabCommand(command, extra = {}) {
    if (!activeTab || typeof activeTab.id !== 'number') return;
    try {
      await browser.tabs.sendMessage(activeTab.id, {
        type: 'vbgpp:command',
        command,
        ...extra,
      });
      await refreshTabState();
    } catch (_) {}
  }

  async function refreshTabState() {
    if (!activeTab || typeof activeTab.id !== 'number') return;
    try {
      const resp = await browser.tabs.sendMessage(activeTab.id, { type: 'vbgpp:getState' });
      if (resp) {
        tabState = resp;
        render();
      }
    } catch (_) {}
  }

  function renderSiteBanner() {
    if (!activeTab || !activeTab.url) {
      el.siteBanner.style.display = 'none';
      return;
    }
    const pattern = core.originToMatchPattern(activeTab.url);
    if (!pattern || core.isBuiltinSupportedUrl(activeTab.url)) {
      el.siteBanner.style.display = 'none';
      return;
    }

    const host = new URL(activeTab.url).hostname;
    const isCustomEnabled = settings.customSites.includes(pattern);
    el.siteBanner.style.display = 'flex';
    if (isCustomEnabled) {
      el.siteLabel.textContent = `Attivo su ${host}`;
      el.siteActionBtn.textContent = 'Disabilita';
      el.siteActionBtn.classList.add('danger');
      el.siteActionBtn.onclick = async () => {
        await browser.runtime.sendMessage({ type: 'vbgpp:disableSite', originPattern: pattern });
        settings = core.normalizeSettings({
          ...settings,
          customSites: settings.customSites.filter((p) => p !== pattern),
        });
        render();
      };
    } else {
      el.siteLabel.textContent = `Abilitare su ${host}?`;
      el.siteActionBtn.textContent = 'Abilita sito';
      el.siteActionBtn.classList.remove('danger');
      el.siteActionBtn.onclick = async () => {
        if (!browser.permissions || typeof browser.permissions.request !== 'function') {
          el.audioStatusNote.textContent =
            'Permessi opzionali non supportati su questa versione di Firefox.';
          return;
        }
        try {
          // Must call permissions.request directly inside user click gesture
          const granted = await browser.permissions.request({ origins: [pattern] });
          if (granted) {
            await browser.runtime.sendMessage({
              type: 'vbgpp:enableSite',
              originPattern: pattern,
              tabId: activeTab.id,
            });
            if (!settings.customSites.includes(pattern)) {
              settings = core.normalizeSettings({
                ...settings,
                customSites: [...settings.customSites, pattern],
              });
            }
            render();
            setTimeout(refreshTabState, 200);
          }
        } catch (_) {
          el.audioStatusNote.textContent =
            'Impossibile richiedere il permesso per questo sito su questa versione di Firefox.';
        }
      };
    }
  }

  function render() {
    el.enabledToggle.checked = settings.enabled;
    el.btnLoop.classList.toggle('active', settings.loop);

    el.btnLinkMode.classList.toggle('linked', settings.linkPitchAndSpeed);
    el.btnLinkMode.textContent = settings.linkPitchAndSpeed
      ? 'Collegati (Tape)'
      : 'Separati';

    el.speedValue.textContent = `${settings.speed.toFixed(2)}x`;
    el.speedRange.value = String(settings.speed);
    for (const btn of el.speedPresets.querySelectorAll('.chip')) {
      btn.classList.toggle('active', Math.abs(Number(btn.dataset.speed) - settings.speed) < 0.01);
    }

    const sign = settings.pitchSemitones > 0 ? '+' : '';
    el.pitchValue.textContent = `${sign}${settings.pitchSemitones.toFixed(1)} st`;
    el.pitchRange.value = String(settings.pitchSemitones);
    for (const btn of el.pitchPresets.querySelectorAll('.chip')) {
      btn.classList.toggle('active', Math.abs(Number(btn.dataset.pitch) - settings.pitchSemitones) < 0.05);
    }

    el.chkAutoResume.checked = settings.autoResume;
    el.chkAutoDismiss.checked = settings.autoDismissPrompts;
    el.chkKeepAlive.checked = settings.keepAlive;
    el.selNotificationMode.value = settings.notificationControlsMode;
    el.selRestartBehavior.value = settings.restartBehavior;
    el.selQuickPill.value = settings.quickPillMode;

    const PLAY_D = 'M4.5 3.2 12.5 8l-8 4.8z';
    const PAUSE_D = 'M4 3h3v10H4zM9 3h3v10H9z';

    if (tabState && tabState.hasMedia) {
      el.mediaTitle.textContent = tabState.title || 'Media attivo';
      el.timeDisplay.textContent = `${formatTime(tabState.currentTime)} / ${formatTime(tabState.duration)}`;
      el.playPausePath.setAttribute('d', tabState.paused ? PLAY_D : PAUSE_D);
      el.playPauseLabel.textContent = tabState.paused ? 'Play' : 'Pausa';

      if (
        tabState.audioStatus === 'cors-blocked' &&
        !settings.linkPitchAndSpeed &&
        Math.abs(settings.pitchSemitones) > 0
      ) {
        el.audioStatusNote.textContent =
          'Stream cross-origin protetto: usa modalità "Collegati" per alterare tonalità su questo sito.';
      } else if (
        tabState.audioStatus === 'worklet-unavailable' &&
        !settings.linkPitchAndSpeed &&
        Math.abs(settings.pitchSemitones) > 0
      ) {
        el.audioStatusNote.textContent = tabState.audioError
          ? `Pitch non disponibile (${tabState.audioError}) — usa modalità "Collegati".`
          : 'Pitch indipendente non disponibile su questa pagina: usa modalità "Collegati".';
      } else {
        el.audioStatusNote.textContent = '';
      }
    } else {
      el.mediaTitle.textContent = activeTab?.title || 'Nessun media rilevato';
      el.timeDisplay.textContent = '--:-- / --:--';
      el.playPausePath.setAttribute('d', PLAY_D);
      el.playPauseLabel.textContent = 'Play';
      el.audioStatusNote.textContent = '';
    }

    renderSiteBanner();
  }

  function bindEvents() {
    el.enabledToggle.addEventListener('change', (e) => updateSetting('enabled', e.target.checked));
    el.btnRestart.addEventListener('click', () => sendTabCommand('restart'));
    el.btnBack.addEventListener('click', () => sendTabCommand('seekBack'));
    el.btnPlayPause.addEventListener('click', () => sendTabCommand('togglePlayPause'));
    el.btnStop.addEventListener('click', () => sendTabCommand('stop'));
    el.btnFwd.addEventListener('click', () => sendTabCommand('seekForward'));
    el.btnLoop.addEventListener('click', () => updateSetting('loop', !settings.loop));
    el.btnLinkMode.addEventListener('click', () =>
      updateSetting('linkPitchAndSpeed', !settings.linkPitchAndSpeed)
    );

    el.speedRange.addEventListener('input', (e) => updateSetting('speed', parseFloat(e.target.value)));
    el.btnResetSpeed.addEventListener('click', () => updateSetting('speed', 1.0));
    el.speedPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-speed]');
      if (btn) updateSetting('speed', parseFloat(btn.dataset.speed));
    });

    el.pitchRange.addEventListener('input', (e) =>
      updateSetting('pitchSemitones', parseFloat(e.target.value))
    );
    el.btnResetPitch.addEventListener('click', () => updateSetting('pitchSemitones', 0));
    el.pitchPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pitch]');
      if (btn) updateSetting('pitchSemitones', parseFloat(btn.dataset.pitch));
    });

    el.chkAutoResume.addEventListener('change', (e) =>
      updateSetting('autoResume', e.target.checked)
    );
    el.chkAutoDismiss.addEventListener('change', (e) =>
      updateSetting('autoDismissPrompts', e.target.checked)
    );
    el.chkKeepAlive.addEventListener('change', (e) =>
      updateSetting('keepAlive', e.target.checked)
    );
    el.selNotificationMode.addEventListener('change', (e) =>
      updateSetting('notificationControlsMode', e.target.value)
    );
    el.selRestartBehavior.addEventListener('change', (e) =>
      updateSetting('restartBehavior', e.target.value)
    );
    el.selQuickPill.addEventListener('change', (e) =>
      updateSetting('quickPillMode', e.target.value)
    );
  }

  async function init() {
    bindEvents();
    try {
      const [stored, tabs] = await Promise.all([
        browser.storage.local.get('vbgppSettings'),
        browser.tabs.query({ active: true, currentWindow: true }),
      ]);
      if (stored && stored.vbgppSettings) {
        settings = core.normalizeSettings(stored.vbgppSettings);
      }
      if (tabs && tabs[0]) {
        activeTab = tabs[0];
      }
    } catch (_) {}

    render();
    await refreshTabState();
    setInterval(refreshTabState, 1000);
  }

  init();
})();

