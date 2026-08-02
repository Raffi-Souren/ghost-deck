# GHOST DECK

> *Replay the Set*

A local-only browser DJ experiment built with Vite, React, and TypeScript.
Load two audio files, perform a transition, record every control movement,
then replay the performance as a **ghost mix** with an animated translucent overlay.

No backend. No accounts. No data leaves your machine.

---

## Quick Start

```bash
git clone https://github.com/raffi-souren/ghost-deck.git
cd ghost-deck
npm install
npm run dev          # open http://localhost:5173
```

Production build:

```bash
npm run build        # outputs to dist/
npm run preview      # serve the built output locally
```

---

## How to Use

1. **Load tracks** — Click **LOAD TRACK** on Deck A and Deck B, or drag-and-drop audio files directly onto either deck. Supports MP3, WAV, OGG, FLAC, AAC, M4A.
2. **Press ● REC** — starts the trace recorder (wall-clock timer begins at 0).
3. **Perform your mix** — play/pause, seek, adjust gain, filter the low-pass, and ride the crossfader.
4. **Press ■ STOP** — stops recording and stores all events.
5. **Press ◈ REPLAY GHOST** — resets both decks to their initial state, then fires every recorded event at the exact same wall-clock offsets. A translucent **ghost marker** (purple bar) tracks the ghost's position on the gain, filter, and crossfader controls.
6. **↓ EXPORT TRACE** — saves the trace as a JSON file (`ghost-deck-trace-<timestamp>.json`).
7. **↑ IMPORT TRACE** — load a previously exported trace. Then hit Replay Ghost.

---

## Architecture

```
src/
├── engine/
│   ├── AudioEngine.ts       Web Audio graph management
│   ├── TraceRecorder.ts     Records & serialises control events
│   └── ReplayScheduler.ts   Schedules replay via setTimeout + AudioContext
├── hooks/
│   ├── useAudioEngine.ts    Singleton engine hook
│   └── useDeckState.ts      30 fps polling of deck playback state
├── components/
│   ├── Deck.tsx             One audio deck (A or B)
│   ├── Crossfader.tsx       Equal-power master crossfader
│   ├── Visualiser.tsx       Canvas spectrum analyser
│   └── TransportControls.tsx REC / STOP / REPLAY / EXPORT / IMPORT
├── App.tsx                  Root component — wires everything together
├── main.tsx                 Entry point
└── index.css                Global retro/CRT styles
```

### Web Audio Graph (per deck)

```
AudioBufferSourceNode
  └─► GainNode (deck gain, 0–1.5)
        └─► BiquadFilterNode (lowpass, 200–20 000 Hz)
              └─► GainNode (xfade side — equal-power)
                    └─► AnalyserNode (visualiser tap)
                          └─► AudioContext.destination
```

### Trace Event Format

```json
{
  "version": 1,
  "recordedAt": "2025-01-01T12:00:00.000Z",
  "events": [
    { "timestampMs": 0,    "deck": "A",      "control": "play",       "value": 1 },
    { "timestampMs": 4200, "deck": "master",  "control": "crossfader", "value": 0.7 },
    { "timestampMs": 8100, "deck": "B",       "control": "gain",       "value": 0.9 }
  ]
}
```

`timestampMs` is always an offset from the start of the recording (0 = REC pressed).

---

## Notes & Known Constraints

- **AudioContext suspended state** — The engine calls `ctx.resume()` before any audio operation to satisfy browser autoplay policies.
- **Object URLs** — When a new track is loaded into a deck the previous `objectURL` is revoked automatically.
- **Replay accuracy** — Events are scheduled via `setTimeout`. Drift of ±20 ms is possible on busy tabs. For higher accuracy consider `AudioWorkletNode` scheduling in a future iteration.
- **No server** — Everything runs in the browser. The `dist/` folder can be served from any static host (GitHub Pages, Netlify, etc.).

---

## Stack

| Tool | Version |
|------|---------|
| Vite | 6.x |
| React | 19.x |
| TypeScript | 5.x |
| Web Audio API | browser-native |

---

*GHOST DECK v0.1 — LOCAL PROCESSING ONLY*
