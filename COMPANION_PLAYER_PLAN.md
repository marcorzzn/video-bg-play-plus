# Piano di Estensione del Progetto: Media Player Android Esterno

## Contesto e Motivazione

L'estensione Firefox **Video Background Play Plus** gestisce riproduzione in background, resilienza di rete, `Loop`, `Stop`, `Ricomincia`, `±5s`, velocità (`0.25x`–`4.00x`) e pitch shifting (`±24` semitoni, collegato o separato) direttamente nel browser.

Tuttavia, su **Firefox per Android** (`org.mozilla.firefox`) il widget multimediale nella tendina delle notifiche e nella schermata di blocco è gestito dal componente nativo `MozacMediaSession`, che espone soltanto la maschera standard (`PLAY | PAUSE | PLAY_PAUSE | SKIP_TO_PREVIOUS | SKIP_TO_NEXT | SEEK_TO`, `actions=822`, `custom actions=[]`). Una WebExtension non può aggiungere pulsanti extra (`Stop`, `Loop`, `Pitch`, `Velocità`) dentro la notifica di sistema di Firefox.

Questo documento propone le architetture possibili per realizzare il **media player esterno** a corredo dell'estensione.

---

## Vincoli della Piattaforma Android (Android 13+ / HyperOS)

Prima di scegliere l'architettura, vanno tenuti presenti due vincoli reali di Android SystemUI:
1. **Media Card di sistema (Schermata di blocco)**: accetta al massimo **5 pulsanti discreti** (`Play/Pause`, `Previous/Rewind`, `Next/Forward` e fino a 2 `CustomAction` con icona personalizzata). Non supporta slider continui (`SeekBar`) per Pitch/Velocità.
2. **Notifica custom espansa (`RemoteViews`)**: nel pannello notifiche (a tendina aperta) permette di visualizzare più righe di **pulsanti discreti** (es. `Pitch -0.5` / `Reset` / `Pitch +0.5`, `Velocità -` / `+`, `Collega/Separa`, `Loop`, `Stop`, `Inizio`, `-5s`, `+5s`), ma non accetta slider interattivi continui.

---

## Proposta 1: App Companion Android "Telecomando" + Bridge WebSocket Locale

Soluzione ideale per **continuare a usare Firefox come browser principale** affiancandogli un'app leggera in Kotlin che mostra i controlli completi nel pannello notifiche.

### Architettura
```text
[Firefox Android + Estensione]
   └─ background.js ──(ws://127.0.0.1:8765 + token)──> [Companion App Kotlin]
                                                            ├─ ForegroundService (mediaPlayback/dataSync)
                                                            ├─ Notifica Custom (RemoteViews) con tutti i tasti
                                                            └─ Quick Settings Tile (opzionale)
```

### Componenti
1. **Bridge nell'estensione Firefox** (`background/background.js`):
   - Client WebSocket leggero verso `ws://127.0.0.1:8765` (solo loopback locale, autenticato con token configurabile).
   - Invia stato aggiornato (`title`, `paused`, `currentTime`, `duration`, `speed`, `pitchSemitones`, `linkPitchAndSpeed`, `loop`, `activeTabId`).
   - Riceve comandi JSON (`togglePlayPause`, `stop`, `restart`, `seek:-5`, `seek:+5`, `toggleLoop`, `deltaPitch:-0.5`, `deltaSpeed:+0.1`, `toggleLink`) e li inoltra al content script attivo.
2. **App Companion Android (Kotlin)**:
   - `ForegroundService` con notifica persistente a due livelli (`RemoteViews` compatta + espansa):
     - **Riga Trasporto**: `Inizio` | `-5s` | `Play/Pausa` | `Stop` | `+5s` | `Loop`
     - **Riga Audio**: `Pitch -` | `Pitch 0` | `Pitch +` | `Vel -` | `Vel +` | `Link`
   - `TileService` nelle Impostazioni Rapide Android per aprire/chiudere al volo la notifica telecomando.

### Pro e Contro
- **Pro**: mantieni il tuo Firefox principale (cronologia, login, uBlock Origin, tab aperte). Sviluppo relativamente rapido e codice isolato.
- **Contro**: nel pannello notifiche compaiono sia la media card standard di Firefox sia la notifica telecomando della Companion App; sulla schermata di blocco HyperOS privilegia comunque la media card di Firefox.

---

## Proposta 2: Mini-App Browser/Player Dedicata su GeckoView (Integrazione Totale)

Soluzione per avere **una singola notifica ufficiale di sistema** con tutti e 5 gli slot personalizzati anche in schermata di blocco, senza duplicati.

### Architettura
```text
[App Android Kotlin (GeckoView + Media3/MediaSessionCompat)]
   ├─ Built-in WebExtension (riusando content/*.js di questo repo)
   ├─ GeckoSession.MediaDelegate (intercetta stato player)
   └─ MediaSessionService Android nativo
        ├─ Media Card Lockscreen (5 bottoni: -5s, Play/Pausa, +5s, Loop, Stop/Inizio)
        └─ Notifica secondaria / Overlay per controlli fini Pitch & Velocità
```

### Componenti
1. **Motore GeckoView (`org.mozilla.geckoview`)**:
   - Carica nativamente gli script già sviluppati in `content/` (`core-logic.js`, `resilience.js`, `pitch-worklet.js`, `audio-engine.js`) come *Built-in WebExtension* (`WebExtensionController.installBuiltIn`).
2. **MediaSessionService Android nativo**:
   - Gestisce direttamente `MediaSessionCompat` e `PlaybackStateCompat` con:
     - `ACTION_REWIND` (`-5s`)
     - `ACTION_PLAY_PAUSE`
     - `ACTION_FAST_FORWARD` (`+5s`)
     - `CustomAction` 1: **Loop On/Off**
     - `CustomAction` 2: **Ricomincia / Stop**
   - Mantiene un `PARTIAL_WAKE_LOCK` pulito durante il buffering/transizioni per la massima resilienza in background.

### Pro e Contro
- **Pro**: esperienza da music player nativo al 100%, **nessuna doppia notifica**, controllo totale dei 5 pulsanti anche a schermo spento, riuso diretto della logica audio/resilienza già testata.
- **Contro**: è un'app separata dal Firefox quotidiano (sessioni e login YouTube separati, anche se comoda come player dedicato tipo NewPipe/Music player).

---

## Proposta 3: Prototipo Rapido senza APK Custom (Tasker / MacroDroid + Server Locale)

Per testare subito l'idea sul dispositivo prima di scrivere un progetto Android Studio/Gradle:
- Aggiungere all'estensione un piccolo ponte WebSocket/HTTP opzionale verso `127.0.0.1` (attivabile da impostazioni avanzate).
- Usare **Tasker** o **MacroDroid** su Android per creare una notifica persistente con pulsanti custom che inviano richieste HTTP/WebSocket locali all'estensione.

---

## Confronto e Roadmap Consigliata

| Criterio | Proposta 1 (Companion + Bridge) | Proposta 2 (App GeckoView) | Proposta 3 (Tasker) |
| :--- | :--- | :--- | :--- |
| Usa il tuo Firefox attuale | Sì | No (app dedicata) | Sì |
| Notifiche duplicate | Sì (Firefox + Telecomando) | No (unica notifica nativa) | Sì |
| Controlli custom in Lockscreen | Limitati (Firefox comanda) | Completi (fino a 5 slot) | Limitati |
| Controlli Pitch/Vel in tendina | Sì (pulsanti `RemoteViews`) | Sì (notifica/overlay) | Sì (base) |
| Complessità sviluppo | Media | Medio-Alta | Bassa |

### Roadmap Suggerita
1. **Fase 1 (Completata)**: Pubblicazione e distribuzione di `Video Background Play Plus` per Firefox Desktop e Android.
2. **Fase 2**: Definire un protocollo JSON stabile (`vbgpp-bridge-v1`) opzionale in `background/background.js` (disattivato di default per massima leggerezza e privacy su AMO).
3. **Fase 3**: Scegliere tra **Proposta 1** (se prioritario restare su Firefox) o **Proposta 2** (se prioritaria una media card unica con `-5s`, `+5s`, `Loop`, `Stop` in schermata di blocco) e avviare il repository Android dedicato.

