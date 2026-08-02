# Ghost Deck Roadmap

## Mission and guardrails

Ghost Deck is the smallest credible replayable-performance instrument: capture a short local two-deck transition as a portable control trace, replay it honestly, inspect it, and eventually practice against it.

The trace—not a feature-complete DJ suite—is the product. The project remains browser-local, dependency-light, and visually rooted in its late-1990s/early-2000s console identity.

## v0.2 — Measured Portable Replay

Status: implemented in the current working tree; pending final real-audio/browser acceptance and repository publication.

| Outcome | Acceptance criterion | Status |
|---|---|---|
| One control path | Mouse/touch, keyboard, and replay use the ControlBus; replay never re-records itself | Done |
| Portable trace v2 | Initial/final state, REC→STOP duration, app version, tracks, FX, and events round-trip | Done |
| v1 migration | Legacy traces import safely and show UNKNOWN track identity | Done |
| Track safety | MATCH/MISSING/MISMATCH/UNKNOWN are visible; mismatch blocks by default | Done |
| Honest replay | Absolute clock, stable ordering, duration completion, cancellation, and measured drift | Done |
| Replay-safe interaction | Loading and performance controls lock while STOP remains available | Done |
| Trace visibility | Timeline shows mixer, filter, FX, transport events, cursor, and duration | Done |
| Real result panel | Completion, applied events, drift, tracks, and final state use measured values | Done |
| Audio safety | Pre-fader analysers, master headroom/limiter, bounds, and valid source offsets | Done |
| Performance FX | CLEAR LPF, delay, reverb/SPACE, CLEAR FX; all captured and replayed | Done |
| Local waveform context | Compact decoded peak envelope with accessible seeking | Done |
| Release gate | Lint, unit tests, production build, CI, versioning, docs, license | Done |
| Manual acceptance | Two real tracks, non-default live start, idle tail, replay, export/import, v1 import, narrow layout | Pending human/browser pass |
| GitHub Pages | Workflow exists and repository Pages source is set to GitHub Actions | Pending repository setting/push |

## v0.3 — Practice Ghost

The next release should separate the reference performance from the live performance instead of mixing both into one control path.

- Ghost trace drives only the reference overlay/path.
- User performs a second transition through the live audio path.
- Both paths remain separately recordable and inspectable.
- Report timing deviation and control-path similarity with plainly documented math.
- Preserve track identity gates and measured scheduler data.
- Add timeline comparison without turning it into a generic analytics dashboard.

Acceptance gate: a user can perform against a ghost without altering the reference trace, then understand where their transition diverged.

## Later research

- AudioWorklet scheduling only if measured main-thread drift is materially limiting.
- MIDI mapping through the existing ControlBus, with no hard-coded device dependency.
- Timeline zoom, scrubbing, denser event inspection, and exportable replay reports.
- Optional richer offline waveform context without building a full waveform-analysis engine.
- Manual tempo metadata and beat-relative delay values only if they can remain explicit; no automatic beatmatching.
- More master metering and limiter-reduction visibility.

## Explicit non-goals

- Streaming-service integrations
- Accounts, authentication, cloud storage, databases, or audio upload
- AI-generated mixes
- Automatic BPM detection, beatmatching, pitch shifting, or DVS
- Social/multiplayer features
- More than two decks
- A copied Mixxx skin, brand, or codebase

## Known limitations to track

- Browser and OS codec support varies.
- Main-thread replay can drift in background or heavily loaded tabs.
- Audio files are never embedded; imported traces still require local files.
- SHA-256 identifies file bytes, not musically equivalent transcodes.
- The fixed delay is not tempo-synced.
- State is in memory until a trace is exported.

## Decision log

- **2026-08 — Trace v2 over feature breadth:** preserve initial/final context, duration, and track identity before adding broader DJ features.
- **2026-08 — Measured over “exact”:** report real browser dispatch drift instead of marketing replay as deterministic.
- **2026-08 — Locked replay:** keep v0.2 reproducible; defer live-vs-ghost interaction to a separate practice mode.
- **2026-08 — Native FX:** add only lightweight delay and deterministic convolution reverb through the trace/control architecture.
- **2026-08 — No AudioWorklet yet:** collect evidence from replay reports before accepting extra scheduler complexity.
