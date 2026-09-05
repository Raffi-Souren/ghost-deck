# Ghost Deck Roadmap

## Mission and guardrails

Ghost Deck is the smallest credible replayable-performance instrument: capture a short local two-deck transition as a portable control trace, replay it honestly, inspect it, and eventually practice against it.

The trace is the product. The project remains browser-local, dependency-light, and visually rooted in its late-1990s/early-2000s console identity and the Bad Company radio and club archive.

## v0.2 — Measured Portable Replay

Status: the replay foundation is implemented and retained in v0.2.1. See the next section for the current upgrade and acceptance status.

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
| GitHub Pages | Static deployment with checks and the `/ghost-deck/` base path | Existing deployment target; main pushes run checks and deploy |

## v0.2.1 — Playable Demo and Console Polish

Status: implemented and verified locally with lint, 44 unit tests, a production build, and browser acceptance at desktop and 390px widths. GitHub Actions gates publication. Dedicated listening/codec acceptance and automated browser end-to-end coverage remain future work.

| Outcome | Acceptance criterion | Status |
|---|---|---|
| Immediate first session | Browser generates two original 120 BPM, eight-bar, 16-second WAV parts with no audio download or autoplay | Implemented; synthesis unit tests pass |
| Reference transition | A 12-second trace moves A to B with filter/delay gestures, known local identities, and measured replay results | Implemented; trace and final-state unit tests pass |
| Session replacement | An inline prompt explains replacement and lets the user keep the current session | Verified in the browser |
| Console identity | Ghost mark, deck color hierarchy, guided session flow, and responsive layout connect to Bad Company's radio/club archive | Verified in the browser |
| Live recording feedback | REC→STOP clock and event count update during recording without cloning the entire trace each frame | Verified in the browser |
| Event inspection | Pointer selection, a selection cursor, accessible Previous/Next controls, and keyboard navigation inspect events without moving audio controls | Verified in the browser |
| Keyboard isolation | Focused controls and timeline/waveform navigation retain their key events | Verified in the browser |
| Operation guards | Record/replay startup, STOP cancellation, demo loading, and async import cannot overlap or replace an active operation | Reviewed; replay locking, immediate Stop, and legacy import verified in browser |

Browser acceptance confirmed the demo completed all 116 events with matching track identity and final state; immediate Stop interrupted cleanly; a new recording captured two moves with a live clock; pointer/keyboard inspection preserved mixer position; export showed success; local WAV replacement blocked mismatched replay; and v1 import migrated with UNKNOWN identities. The 390px layout had no page-level horizontal overflow.

Trace format v2, local file identities, the single ControlBus, and measured replay remain the foundation. Demo synthesis adds no dependencies or remote audio assets. Keep the separate live-versus-reference practice flow for v0.3.

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
- The 100,000-event limit can produce exported JSON larger than the 5 MB import limit. Such traces cannot currently round-trip; align capture/export and import bounds in a future fix. This existing issue is deferred from v0.2.1.

## Decision log

- **2026-08 — Trace v2 over feature breadth:** preserve initial/final context, duration, and track identity before adding broader DJ features.
- **2026-08 — Measured over “exact”:** report real browser dispatch drift instead of marketing replay as deterministic.
- **2026-08 — Locked replay:** keep v0.2 reproducible; defer live-vs-ghost interaction to a separate practice mode.
- **2026-08 — Native FX:** add only lightweight delay and deterministic convolution reverb through the trace/control architecture.
- **2026-08 — No AudioWorklet yet:** collect evidence from replay reports before accepting extra scheduler complexity.
- **2026-09 — A playable first transition:** generate quiet, original demo parts locally and run their reference trace through the existing identity and measured replay paths.
- **2026-09 — Console polish before practice mode:** clarify the session flow, recording feedback, inspection, and operation boundaries while preserving v0.3 Practice Ghost as separate work.
