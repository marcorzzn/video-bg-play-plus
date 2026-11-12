<div align="center">
  <img src="icon.svg" alt="Video Background Play Plus icon" width="84" height="84" />
  <h1>Video Background Play Plus</h1>
  <p>
    <strong>Riproduzione in background resiliente, controlli Media Session avanzati, Loop, Velocità e Pitch per Firefox (Desktop &amp; Android).</strong><br />
    <em>Resilient background playback, enhanced Media Session controls, Loop, Speed, and Pitch for Firefox (Desktop &amp; Android).</em>
  </p>
  <p>
    <a href="#italiano">🇮🇹 Italiano</a> · <a href="#english">🇬🇧 English</a> · <a href="COMPANION_PLAYER_PLAN.md">📱 Android Companion Plan</a>
  </p>
</div>

---

<a id="italiano"></a>
## 🇮🇹 Italiano

### A cosa serve
**Video Background Play Plus** è un fork potenziato di [Video Background Play Fix](https://github.com/timdream/video-background-play-fix) pensato soprattutto per **Firefox per Android** (e compatibile con Firefox Desktop).

Permette di continuare ad ascoltare e controllare video o musica quando cambi scheda, passi a un'altra app o spegni lo schermo, offrendo in più un pannello di controllo rapido leggero per velocità, tonalità (pitch), loop e ricerca rapida.

---

### Cosa fa in più e come migliora rispetto all'originale

| Area | Versione originale (*Fix*) | Video Background Play Plus | Come garantisce il miglioramento |
| :--- | :--- | :--- | :--- |
| **Background &amp; Resilienza** | Nasconde `visibilityState` e simula un tasto Alt ogni ~60s su YouTube. | Tutto questo **+** auto-ripresa su pause inattese, chiusura avvisi *"Continua a guardare?"*, recovery su stall di rete e keep-alive audio. | Distingue le pause manuali dell'utente (`isTrusted` / `MediaSession`) da quelle forzate dal browser/sito; riprova con backoff esponenziale, osserva i dialoghi `ytmusic-you-there-renderer` / `yt-confirm-dialog-renderer` e usa un impulso audio sub-udibile solo durante la riproduzione attiva. |
| **Velocità &amp; Tonalità (Pitch)** | Non presente. | Velocità `0.25x`–`4.00x` e Pitch `±24` semitoni in modalità **Separata** o **Collegata (Tape)**. | In modalità **Collegata** applica una biiezione matematica esatta ($\text{st} = 12 \log_2(\text{speed}) + \text{offset}$) usando `preservesPitch = false` nativo a carico CPU nullo. In modalità **Separata** usa un `AudioWorklet` granulare WSOLA (finestra di Hann) con fallback automatico inline su `ScriptProcessorNode` (immune alla CSP di YouTube), bypassato a `0 st`. |
| **Media Player &amp; Notifica** | Nessun controllo dedicato. | `Play/Pausa`, `Stop` (pausa + `0:00`), `-5s`, `+5s`, `Ricomincia`, `Loop`, barra di avanzamento sincronizzata al `playbackRate`. | Aggancia `navigator.mediaSession` + hook anti-sovrascrittura su YouTube/YT Music, forza il `Loop` anche contro l'autoplay delle SPA e consente di rimappare i tasti `⏮`/`⏭` della notifica Android (es. `-5s / +5s` o `Inizio / +5s`). |
| **UI &amp; Integrazione** | Nessuna UI. | Popup **Firefox Proton/Acorn** (chiaro/scuro automatico) + **mini-pillola** in pagina su mobile (Shadow DOM). | Non sporca la pagina con librerie pesanti: usa puro JS/CSS con variabili `prefers-color-scheme` e icone SVG vettoriali. |
| **Siti Supportati** | YouTube, YouTube-nocookie, Vimeo. | YouTube (`m.`, `music.`), YouTube-nocookie, Vimeo **+** qualsiasi altro sito attivabile dal popup. | Usa `optional_permissions` per chiedere l'accesso a nuovi domini solo su richiesta esplicita dell'utente. |

---

### Limiti onesti e trasparenza tecnica
* **Notifica di sistema / Schermata di blocco su Android**: su Firefox per Android il widget multimediale nella tendina delle notifiche e nella lockscreen è gestito dal codice nativo di Firefox (`MozacMediaSession`), che espone solo `Play/Pausa`, `Precedente (⏮)`, `Successivo (⏭)` e barra temporale (`actions=822`). **Nessuna estensione Firefox** può aggiungere slider di Pitch/Velocità o bottoni extra (`Stop`, `Loop`) dentro la notifica di sistema di Firefox.
  * *Soluzione attuale nell'estensione*: tutti i controlli completi sono nella mini-pillola in pagina e nel popup; inoltre puoi rimappare `⏮` e `⏭` della lockscreen su `-5s / +5s` oppure `Inizio / +5s`.
  * *Sviluppo futuro esterno*: vedi [COMPANION_PLAYER_PLAN.md](COMPANION_PLAYER_PLAN.md) per le proposte di un'app Android companion / GeckoView dedicata.
* **Stream cross-origin senza CORS**: su alcuni siti esterni che servono `<video src="https://...">` da un altro dominio senza header CORS (diversamente da YouTube che usa MSE `blob:`), le regole di sicurezza Web Audio impediscono l'elaborazione del pitch indipendente. In quel caso l'estensione **non** silenzia l'audio e disattiva in sicurezza solo il pitch indipendente (la modalità *Collegata* continua a funzionare).

---

### Come caricarla e testarla su Firefox

#### 1. Firefox Desktop (test rapido)
1. Scarica o clona questa repository.
2. Apri `about:debugging#/runtime/this-firefox`.
3. Clicca **Carica componente aggiuntivo temporaneo…** e seleziona [manifest.json](manifest.json).

#### 2. Firefox per Android (sviluppo e test via USB con `web-ext`)
> La voce *"Installa componente aggiuntivo da file"* su Firefox Android standard accetta **solo** pacchetti `.xpi` firmati da Mozilla. Per testare il codice locale non firmato usa `web-ext`:
1. Attiva **Debug USB** nelle *Opzioni sviluppatore* di Android e collega il telefono al PC.
2. Su Firefox Android vai in **Impostazioni → Informazioni su Firefox** e tocca **5 volte** il logo Firefox per sbloccare il menu sviluppatore; torna in **Impostazioni** e attiva **Debug remoto tramite USB**.
3. Verifica il dispositivo con `adb devices` ed esegui dalla cartella del progetto:
   ```sh
   npx web-ext run --target=firefox-android --no-input --ignore-files tests README.md Makefile COMPANION_PLAYER_PLAN.md web-ext-artifacts
   ```

#### 3. Installazione permanente su Firefox (Desktop &amp; Android)
1. Esegui i test e genera il pacchetto distribuibile:
   ```sh
   node --test tests/*.test.js
   npx web-ext lint --ignore-files tests README.md Makefile COMPANION_PLAYER_PLAN.md web-ext-artifacts
   npx web-ext build --overwrite-dest --ignore-files tests README.md Makefile COMPANION_PLAYER_PLAN.md web-ext-artifacts
   ```
2. Carica il file `.zip` generato in `web-ext-artifacts/` su [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) (pubblico oppure *Unlisted* per uso personale firmato da Mozilla).
3. Su Firefox Android installa la versione pubblicata da AMO oppure, per pacchetti *Unlisted* scaricati sul telefono, usa **Impostazioni → Installa componente aggiuntivo da file** (dopo aver sbloccato il menu sviluppatore).

---

<a id="english"></a>
## 🇬🇧 English

### Purpose
**Video Background Play Plus** is an enhanced fork of [Video Background Play Fix](https://github.com/timdream/video-background-play-fix), built with a strong focus on **Firefox for Android** (while remaining fully compatible with Firefox Desktop).

It keeps HTML5 video and audio playing reliably when you switch tabs, move to another app, or turn off your screen, and adds a lightweight control suite for transport, loop, playback speed, and pitch shifting.

---

### What it adds &amp; how it improves over the original

| Area | Original (*Fix*) | Video Background Play Plus | How the improvement works |
| :--- | :--- | :--- | :--- |
| **Background &amp; Resilience** | Spoofs `visibilityState` and sends a synthetic Alt key every ~60s on YouTube. | All of the above **+** unexpected-pause recovery, *"Continue watching?"* auto-dismissal, stall recovery, and audio keep-alive. | Distinguishes real user pauses (`isTrusted` / `MediaSession`) from browser/site-triggered pauses, retries with exponential backoff, dismisses `ytmusic-you-there-renderer` / `yt-confirm-dialog-renderer` prompts, and runs a sub-audible keep-alive pulse only while playback is active. |
| **Speed &amp; Pitch** | Not available. | Speed `0.25x`–`4.00x` and Pitch `±24` semitones in **Unlinked (Independent)** or **Linked (Tape)** mode. | **Linked** mode maintains an exact mathematical bijection ($\text{st} = 12 \log_2(\text{speed}) + \text{offset}$) using native `preservesPitch = false` at zero DSP CPU cost. **Unlinked** mode uses a lightweight WSOLA Hann-window granular `AudioWorklet` with automatic inline `ScriptProcessorNode` fallback (immune to YouTube CSP), bypassed cleanly at `0 st`. |
| **Media Session &amp; Player** | None. | `Play/Pause`, `Stop` (pause + reset to `0:00`), `-5s`, `+5s`, `Restart`, `Loop`, and position state synced with `playbackRate`. | Hooks `navigator.mediaSession` against YouTube/YT Music overwrites, enforces `Loop` even against SPA autoplay, and lets you remap Android lockscreen `⏮`/`⏭` buttons (e.g., `-5s / +5s` or `Restart / +5s`). |
| **UI &amp; Integration** | No UI. | **Firefox Proton/Acorn** popup (auto Light/Dark) + discreet Shadow-DOM mobile **quick pill**. | Zero external runtime frameworks; uses native `prefers-color-scheme` tokens and crisp vector SVG icons. |
| **Supported Sites** | YouTube, YouTube-nocookie, Vimeo. | YouTube (`m.`, `music.`), YouTube-nocookie, Vimeo **+** any extra site enabled on demand. | Uses `optional_permissions` so extra domain permissions are only requested when the user explicitly clicks *Enable site*. |

---

### Honest Limitations
* **Android System Notification / Lockscreen**: On Firefox for Android, the system media notification card is rendered by Firefox's native Kotlin layer (`MozacMediaSession`), which only exposes `Play/Pause`, `Previous (⏮)`, `Next (⏭)`, and the seekbar (`actions=822`). **No Firefox WebExtension** can add custom sliders (Pitch/Speed) or extra buttons (`Stop`, `Loop`) into Firefox's native Android notification.
  * *In-extension solution*: full controls live in the in-page quick pill and extension popup, and you can remap the lockscreen `⏮`/`⏭` buttons to `-5s / +5s` or `Restart / +5s`.
  * *Future companion app*: see [COMPANION_PLAYER_PLAN.md](COMPANION_PLAYER_PLAN.md) for standalone/companion Android player architectures.
* **Cross-origin streams without CORS**: on third-party sites serving direct cross-origin `<video src="https://...">` URLs without CORS headers (unlike YouTube's MSE `blob:` streams), browser Web Audio security blocks independent pitch processing. In that case the extension safely falls back without muting audio (Linked mode still works).

---

### How to load and test on Firefox

#### 1. Firefox Desktop (quick test)
1. Clone or download this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select [manifest.json](manifest.json).

#### 2. Firefox for Android (USB development with `web-ext`)
> *"Install add-on from file"* in release Firefox for Android **only** accepts Mozilla-signed `.xpi` files. To test unsigned local builds, use `web-ext`:
1. Enable **USB Debugging** in Android Developer Options and connect your phone via USB.
2. In Firefox for Android, open **Settings → About Firefox** and tap the Firefox logo **5 times** to unlock Developer tools; go back to **Settings** and enable **Remote debugging via USB**.
3. Verify the device with `adb devices` and run from the project root:
   ```sh
   npx web-ext run --target=firefox-android --no-input --ignore-files tests README.md Makefile COMPANION_PLAYER_PLAN.md web-ext-artifacts
   ```

#### 3. Packaging &amp; Permanent Installation (Desktop &amp; Android)
1. Run tests, lint, and build the distributable `.zip`:
   ```sh
   node --test tests/*.test.js
   npx web-ext lint --ignore-files tests README.md Makefile COMPANION_PLAYER_PLAN.md web-ext-artifacts
   npx web-ext build --overwrite-dest --ignore-files tests README.md Makefile COMPANION_PLAYER_PLAN.md web-ext-artifacts
   ```
2. Upload the `.zip` from `web-ext-artifacts/` to [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) (listed for everyone, or *Unlisted* for Mozilla-signed self-distribution).
3. On Firefox for Android, install from AMO or use **Settings → Install add-on from file** with the Mozilla-signed `.xpi`.

---

## License / Licenza

* Extension code: **MIT** (forked from *Video Background Play Fix* by timdream; see [LICENSE](LICENSE)).
* Logo: based on "[Glasses](https://thenounproject.com/term/glasses/1473422)" by rahmatmasiv under [CC BY 3.0 US](https://creativecommons.org/licenses/by/3.0/us/), modified with a red `+` badge for Video Background Play Plus.
