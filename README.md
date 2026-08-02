# GHOST DECK

> **Replay the transition—not the whole DJ suite.**

Ghost Deck is a local, two-deck browser instrument for capturing a short DJ transition as a portable control trace, replaying it as a ghost, and inspecting what actually happened.

The transition trace is the product. Ghost Deck deliberately does not attempt to become a browser clone of Mixxx or a streaming platform.

Audio files, fingerprints, and traces stay in your browser. There is no backend, account, upload path, analytics, or telemetry.

## What v0.2 adds

- Trace format v2 stores the full initial and final engine snapshots, REC→STOP duration, app version, locally computed track identity, and every user control event.
- Pressing REC while a deck is already playing now preserves its cue position and playback state.
- SHA-256 fingerprints are computed locally with Web Crypto. A missing or mismatched expected track is shown before replay; mismatches require an explicit local override.
- Replay uses one absolute AudioContext clock, stable event ordering, drift correction, duration-based completion, and clean interruption.
- Every run reports real mean, p95, and maximum dispatch drift, applied events, track status, and final-state agreement.
- The Trace Path visualizes crossfader, gain, logarithmic filter, delay, reverb, and transport movements.
- Each deck includes a logarithmic low-pass filter with **CLEAR LPF**, a fixed 375 ms feedback **DELAY**, convolution reverb (**SPACE**), and **CLEAR FX**. FX are captured and replayed like every other control.
- Mouse, touch, keyboard, track loading, and ghost replay share one lightweight `ControlBus`; live input is locked while the ghost has control.
- A master gain and safety limiter protect the combined deck output. Per-deck spectrum analysers remain pre-fader.
- A compact local waveform envelope supports pointer and keyboard seeking without uploading or retaining another PCM copy.

## Run locally

Requires Node.js `^20.19.0` or `>=22.12.0`.

```bash
git clone https://github.com/Raffi-Souren/ghost-deck.git
cd ghost-deck
npm ci
npm run dev
```

Open `http://localhost:5173/` (Vite will print another port if 5173 is occupied).

Production and verification commands:

```bash
npm run lint
npm run test:run
npm run build
npm run check       # lint + tests + production build
npm run preview
```

## Record and replay a transition

1. Load local audio into Deck A and/or Deck B. Decoding support depends on the browser and operating system codec stack.
2. Cue the tracks. You may seek, play, set gain/filter, add delay or reverb, and position the crossfader before recording.
3. Press **● REC**. Ghost Deck snapshots both decks, the mixer, FX, and local track identities at that moment.
4. Perform the transition. UI and keyboard movements flow through the same recorder path.
5. Press **■ STOP**. The final state and the complete REC→STOP duration are retained, including silence after the last gesture.
6. Inspect **TRACE PATH**. Focus it and use Left/Right, Home, and End to inspect recorded events.
7. Press **◈ REPLAY GHOST**. Matching tracks are checked, the initial state is restored, and user input is locked until completion or STOP.
8. Review the measured replay result instead of assuming timing was exact.
9. Export the trace as JSON or import it later. Audio is never embedded in the trace, so corresponding local tracks still need to be loaded.

### Keyboard input

| Keys | Action |
|---|---|
| `Q` / `W` | Deck A play / pause |
| `O` / `P` | Deck B play / pause |
| `A` / `S` | Deck A gain down / up |
| `K` / `L` | Deck B gain down / up |
| `Z` / `X` | Deck A low-pass down / up |
| `M` / `,` | Deck B low-pass down / up |
| `←` / `→` | Crossfader left / right |
| `Space` | Toggle Deck A |

Shortcuts do not hijack focused buttons, inputs, text fields, or editable content.

## Portable trace format

New exports use version 2:

```ts
type TraceFileV2 = {
  version: 2;
  appVersion: string;
  recordedAt: string;
  durationMs: number;
  tracks: {
    A: TraceTrackReference;
    B: TraceTrackReference;
  };
  initialState: EngineSnapshot;
  finalState: EngineSnapshot;
  events: TraceEvent[];
};
```

Track identities contain the local filename, byte size, MIME type, decoded duration, and—when Web Crypto is available—a SHA-256 fingerprint. A fingerprint is not an audio upload and never leaves the browser unless the user explicitly exports the JSON trace.

Imports are bounded and deeply validated: schema version, targets, controls, source, finite values, control ranges, snapshots, track metadata, timestamps, event count, file size, and total duration. Events are stably sorted before use.

Version 1 traces remain importable. They migrate to safe default snapshots and show track identity as **UNKNOWN**, because v1 never recorded that context. Their original replay context cannot be reconstructed.

## Replay timing

Ghost Deck does not claim sample-accurate or deterministic browser scheduling. The scheduler:

- restores the initial engine snapshot only after `AudioContext.resume()` resolves;
- uses a single AudioContext clock origin;
- dispatches each event against its absolute target rather than chaining relative delays;
- catches up without accumulating timer drift;
- finishes at `durationMs`, not at the final control event;
- records target time, actual dispatch time, and signed drift for every event.

Background tabs, a busy main thread, power-saving behavior, and browser audio implementation can still increase drift. The measured result panel makes that limitation visible. An AudioWorklet scheduler is intentionally deferred until real measurements justify the complexity.

## Audio graph

```text
BufferSource
  → deck gain
  → low-pass filter
  → pre-fader deck analyser
      ├→ dry ──────────────────────────────┐
      ├→ 375 ms delay → feedback → wet ───┤
      └→ convolution reverb → wet ────────┤
                                          ↓
                                  crossfader-side gain

Deck A + Deck B
  → master headroom gain
  → DynamicsCompressor safety limiter
  → master analyser
  → destination
```

The delay and reverb are intentionally lightweight, fixed-character performance effects. They use browser-native Web Audio nodes and no DSP dependency.

## Architecture

```text
src/
├── engine/
│   ├── ControlBus.ts          validated input/replay dispatch
│   ├── AudioEngine.ts         Web Audio graph, snapshots, FX, safety bounds
│   ├── TraceRecorder.ts       trace v2 capture, migration, validation, JSON
│   ├── ReplayScheduler.ts     absolute-clock measured replay
│   ├── ReplayMetrics.ts       drift and final-state comparison
│   ├── TrackIdentity.ts       local SHA-256 and match classification
│   ├── AudioMath.ts           equal-power and logarithmic mappings
│   ├── KeyboardController.ts  keyboard → ControlBus
│   └── Waveform.ts            compact local peak extraction
├── components/
│   ├── Deck.tsx
│   ├── Crossfader.tsx
│   ├── TraceTimeline.tsx
│   ├── ReplayReportPanel.tsx
│   ├── TransportControls.tsx
│   ├── WaveformOverview.tsx
│   └── Visualiser.tsx
├── hooks/useDeckState.ts
├── App.tsx
└── index.css
```

## Shipping

- CI runs lint, the unit suite, and a production build on pushes and pull requests.
- The Pages workflow builds for the `/ghost-deck/` project path and deploys `dist/` after checks pass. GitHub Pages must be configured to use **GitHub Actions** in repository settings.
- The app is static. Hosting the page transfers HTML/CSS/JavaScript assets; selected audio and trace data are not sent to that host.

## Known limitations

- Audio decode support varies by browser and OS. WAV and MP3 are common; OGG, FLAC, AAC, and M4A are not guaranteed everywhere.
- Imported traces do not contain audio. Track matching prevents silent substitution but cannot fetch the original file.
- Timing is main-thread measured replay, not sample-accurate automation.
- The delay is fixed at 375 ms and is not beat-synced. Automatic BPM detection and beatmatching are deliberate non-goals.
- Reloading the page clears decoded tracks and the in-memory trace unless it was exported.
- The current practice mode is replay-only: user controls are locked rather than mixed into the ghost path.

See [ROADMAP.md](ROADMAP.md) for what was accepted from the v0.1 audit, what remains, and the v0.3 Practice Ghost direction.

## Stack

| Tool | Version line |
|---|---|
| React | 19.x |
| Vite | 8.x |
| TypeScript | 6.x |
| Vitest | 4.x |
| Web Audio API | browser-native |

## License

[MIT](LICENSE) © 2026 Raffi Khatchadourian
