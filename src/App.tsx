import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_VERSION } from "./version";
import { ControlBus, type DeckId } from "./engine/ControlBus";
import { AudioEngine } from "./engine/AudioEngine";
import { TraceRecorder, type TraceSession } from "./engine/TraceRecorder";
import { ReplayScheduler } from "./engine/ReplayScheduler";
import { compareSnapshots, type ReplayOutcome, type ReplayTimingReport } from "./engine/ReplayMetrics";
import { KeyboardController } from "./engine/KeyboardController";
import {
  classifyTracks,
  type LoadedTracks,
  type TrackIdentity,
  type TrackMatches,
} from "./engine/TrackIdentity";
import { Deck } from "./components/Deck";
import { Crossfader } from "./components/Crossfader";
import { TraceTimeline } from "./components/TraceTimeline";
import { TransportControls } from "./components/TransportControls";
import { ReplayReportPanel } from "./components/ReplayReportPanel";
import { GhostMark } from "./components/GhostMark";
import { SessionGuide } from "./components/SessionGuide";

const bus = new ControlBus();
const engine = new AudioEngine(bus);
const recorder = new TraceRecorder(bus);
const scheduler = new ReplayScheduler();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    scheduler.reset();
    recorder.destroy();
    void engine.destroy();
  });
}

interface GhostState {
  gainA?: number;
  gainB?: number;
  filterA?: number;
  filterB?: number;
  delayA?: number;
  delayB?: number;
  reverbA?: number;
  reverbB?: number;
  crossfader?: number;
}

const EMPTY_TRACKS: LoadedTracks = { A: null, B: null };
const EMPTY_LOADING_STATE: Record<DeckId, boolean> = { A: false, B: false };

function traceNeedsDeck(trace: TraceSession, deck: DeckId) {
  if (trace.initialState[deck].duration > 0 || trace.initialState[deck].isPlaying) return true;
  return trace.events.some((event) =>
    event.deck === deck && (event.control === "play" || event.control === "seek"),
  );
}

function findReplayIssue(
  trace: TraceSession | null,
  matches: TrackMatches | null,
  allowMismatch: boolean,
): string | null {
  if (!trace || !matches) return null;
  for (const deck of ["A", "B"] as const) {
    if (matches[deck] === "missing") return `LOAD THE EXPECTED DECK ${deck} TRACK BEFORE REPLAY`;
    if (matches[deck] === "unknown" && traceNeedsDeck(trace, deck) && !engine.hasBuffer(deck)) {
      return `V1 TRACE: LOAD THE CORRESPONDING DECK ${deck} TRACK`;
    }
  }
  if (!allowMismatch && (matches.A === "mismatch" || matches.B === "mismatch")) {
    return "TRACK IDENTITY MISMATCH · VERIFY OR USE THE LOCAL OVERRIDE";
  }
  return null;
}

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [trace, setTrace] = useState<TraceSession | null>(null);
  const [ghost, setGhost] = useState<GhostState>({});
  const [loadedTracks, setLoadedTracks] = useState<LoadedTracks>(EMPTY_TRACKS);
  const [loadingDecks, setLoadingDecks] = useState(EMPTY_LOADING_STATE);
  const [allowMismatch, setAllowMismatch] = useState(false);
  const [replayOutcome, setReplayOutcome] = useState<ReplayOutcome | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [isDemoLoading, setIsDemoLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [demoReady, setDemoReady] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [recordingStats, setRecordingStats] = useState<{ durationMs: number; eventCount: number } | null>(null);
  const operationRef = useRef<"recording" | "replaying" | "demo" | "importing" | null>(null);
  const operationGeneration = useRef(0);
  const loadingRef = useRef<Record<DeckId, boolean>>({ A: false, B: false });
  const keyboardRef = useRef<KeyboardController | null>(null);

  useEffect(() => {
    keyboardRef.current = new KeyboardController(bus, engine);
    return () => keyboardRef.current?.destroy();
  }, []);

  useEffect(() => {
    keyboardRef.current?.setEnabled(!isReplaying && !isDemoLoading);
  }, [isReplaying, isDemoLoading]);

  useEffect(() => {
    if (!isRecording) { setRecordingStats(null); return; }
    const update = () => setRecordingStats({
      durationMs: recorder.isRecording ? bus.elapsedMs() : 0,
      eventCount: recorder.isRecording ? recorder.eventCount : 0,
    });
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => bus.subscribe((event) => {
    if (event.source !== "ghost") return;
    setGhost((current) => {
      const next = { ...current };
      if (event.deck === "A") {
        if (event.control === "gain") next.gainA = event.value;
        if (event.control === "filter") next.filterA = event.value;
        if (event.control === "delay") next.delayA = event.value;
        if (event.control === "reverb") next.reverbA = event.value;
      }
      if (event.deck === "B") {
        if (event.control === "gain") next.gainB = event.value;
        if (event.control === "filter") next.filterB = event.value;
        if (event.control === "delay") next.delayB = event.value;
        if (event.control === "reverb") next.reverbB = event.value;
      }
      if (event.control === "crossfader") next.crossfader = event.value;
      return next;
    });
  }), []);

  const trackMatches = useMemo(
    () => trace ? classifyTracks(trace.tracks, loadedTracks) : null,
    [loadedTracks, trace],
  );
  const replayIssue = findReplayIssue(trace, trackMatches, allowMismatch);
  const isTrackLoading = loadingDecks.A || loadingDecks.B || isDemoLoading;
  const trackCount = Number(Boolean(loadedTracks.A)) + Number(Boolean(loadedTracks.B));

  const handleTrackLoaded = useCallback((deck: DeckId, track: TrackIdentity) => {
    setLoadedTracks((current) => ({ ...current, [deck]: track }));
    setDemoReady(false);
    setConfirmDemo(false);
    setRuntimeError("");
  }, []);

  const handleLoadingChange = useCallback((deck: DeckId, isLoading: boolean) => {
    loadingRef.current[deck] = isLoading;
    setLoadingDecks((current) => ({ ...current, [deck]: isLoading }));
  }, []);

  const handleRecord = useCallback(async () => {
    if (operationRef.current || loadingRef.current.A || loadingRef.current.B) return;
    operationRef.current = "recording";
    const generation = ++operationGeneration.current;
    setIsRecording(true);
    setConfirmDemo(false);
    try {
      await engine.resume();
      if (generation !== operationGeneration.current) return;
      const initialState = engine.getSnapshot();
      bus.resetClock();
      scheduler.reset();
      recorder.start(initialState, loadedTracks);
      setTrace(null);
      setDemoReady(false);
      setGhost({});
      setReplayOutcome(null);
      setAllowMismatch(false);
      setRuntimeError("");
    } catch (error) {
      if (generation !== operationGeneration.current) return;
      operationRef.current = null;
      setIsRecording(false);
      setRuntimeError(`RECORD FAILED · ${(error as Error).message}`);
    }
  }, [loadedTracks]);

  const buildOutcome = useCallback((
    timing: ReplayTimingReport,
    matches: TrackMatches,
    completed: boolean,
    overrideUsed: boolean,
  ): ReplayOutcome => {
    const supportsFinalCheck = trace && trace.tracks.A.status === "known" && trace.tracks.B.status === "known";
    const actualFinalState = engine.getSnapshot();
    const finalState = completed && trace && supportsFinalCheck
      ? compareSnapshots(trace.finalState, actualFinalState, timing.maxAbsoluteDriftMs ?? 100)
      : null;
    return { timing, tracks: matches, overrideUsed, finalState };
  }, [trace]);

  const finishReplay = useCallback((outcome: ReplayOutcome) => {
    engine.stopAll();
    bus.setUserInputEnabled(true);
    setIsReplaying(false);
    setGhost({});
    setReplayOutcome(outcome);
    operationRef.current = null;
  }, []);

  const handleStop = useCallback(() => {
    operationGeneration.current += 1;
    if (isRecording) {
      if (recorder.isRecording) setTrace(recorder.stop(engine.getSnapshot()));
      setIsRecording(false);
      setReplayOutcome(null);
      operationRef.current = null;
      return;
    }

    if (isReplaying) {
      const timing = scheduler.stop();
      const matches = trackMatches ?? { A: "unknown", B: "unknown" };
      if (timing) finishReplay(buildOutcome(timing, matches, false, allowMismatch));
      else {
        engine.stopAll();
        bus.setUserInputEnabled(true);
        setIsReplaying(false);
        setGhost({});
        operationRef.current = null;
      }
    }
  }, [allowMismatch, buildOutcome, finishReplay, isRecording, isReplaying, trackMatches]);

  const handleReplay = useCallback(async () => {
    if (!trace || !trackMatches || replayIssue || operationRef.current || loadingRef.current.A || loadingRef.current.B) return;
    operationRef.current = "replaying";
    const generation = ++operationGeneration.current;
    const matchesAtStart = { ...trackMatches };
    const overrideUsed = allowMismatch && (
      matchesAtStart.A === "mismatch" || matchesAtStart.B === "mismatch"
    );

    setIsReplaying(true);
    setReplayOutcome(null);
    setRuntimeError("");
    setConfirmDemo(false);
    scheduler.reset();
    bus.setUserInputEnabled(false);

    try {
      await engine.resume();
      if (generation !== operationGeneration.current) return;
      engine.applySnapshot(trace.initialState);
      setGhost({
        gainA: trace.initialState.A.gain,
        gainB: trace.initialState.B.gain,
        filterA: trace.initialState.A.filterFreq,
        filterB: trace.initialState.B.filterFreq,
        delayA: trace.initialState.A.delayMix,
        delayB: trace.initialState.B.delayMix,
        reverbA: trace.initialState.A.reverbMix,
        reverbB: trace.initialState.B.reverbMix,
        crossfader: trace.initialState.crossfader,
      });

      scheduler.start(trace, bus, {
        clock: () => engine.ctx.currentTime * 1000,
        onDone: (timing) => {
          finishReplay(buildOutcome(timing, matchesAtStart, true, overrideUsed));
        },
      });
    } catch (error) {
      if (generation !== operationGeneration.current) return;
      engine.stopAll();
      bus.setUserInputEnabled(true);
      setIsReplaying(false);
      setGhost({});
      operationRef.current = null;
      setRuntimeError(`REPLAY FAILED · ${(error as Error).message}`);
    }
  }, [allowMismatch, buildOutcome, finishReplay, replayIssue, trace, trackMatches]);

  const handleClear = useCallback(() => {
    if (operationRef.current) return;
    scheduler.reset();
    recorder.clear();
    setTrace(null);
    setGhost({});
    setReplayOutcome(null);
    setAllowMismatch(false);
    setRuntimeError("");
    setDemoReady(false);
  }, []);

  const handleImport = useCallback((imported: TraceSession) => {
    if (operationRef.current && operationRef.current !== "importing") return false;
    scheduler.reset();
    recorder.load(imported);
    setTrace(imported);
    setGhost({});
    setReplayOutcome(null);
    setAllowMismatch(false);
    setRuntimeError("");
    setDemoReady(false);
    setConfirmDemo(false);
    return true;
  }, []);

  const handleImportLoadingChange = useCallback((loading: boolean) => {
    setIsImporting(loading);
    if (loading && !operationRef.current) operationRef.current = "importing";
    if (!loading && operationRef.current === "importing") operationRef.current = null;
  }, []);

  const handleDemo = useCallback(async () => {
    if (operationRef.current || loadingRef.current.A || loadingRef.current.B) return;
    if ((trackCount > 0 || trace) && !confirmDemo) { setConfirmDemo(true); return; }
    operationRef.current = "demo";
    setIsDemoLoading(true);
    setConfirmDemo(false);
    setRuntimeError("");
    bus.setUserInputEnabled(false);
    engine.stopAll();
    try {
      const { loadDemoSession } = await import("./engine/DemoSession");
      const demo = await loadDemoSession(engine, handleTrackLoaded);
      setLoadedTracks(demo.tracks);
      engine.applySnapshot({
        ...demo.trace.initialState,
        A: { ...demo.trace.initialState.A, isPlaying: false },
        B: { ...demo.trace.initialState.B, isPlaying: false },
      });
      scheduler.reset();
      recorder.load(demo.trace);
      setTrace(demo.trace);
      setReplayOutcome(null);
      setAllowMismatch(false);
      setGhost({});
      setDemoReady(true);
    } catch (error) {
      setRuntimeError(`Could not load the demo: ${(error as Error).message}. Try again or load your own tracks.`);
    } finally {
      bus.setUserInputEnabled(true);
      operationRef.current = null;
      setIsDemoLoading(false);
    }
  }, [confirmDemo, handleTrackLoaded, trace, trackCount]);

  const getReplayProgressMs = useCallback(() => scheduler.progressMs, []);

  return (
    <div className="app">
      <a className="skip-link" href="#console">Skip to the decks</a>
      <header className="app-header">
        <a className="company-link" href="https://www.notgoodcompany.com/" target="_blank" rel="noreferrer">BAD COMPANY</a>
        <span className="header-context">Independent sound experiments</span>
        <div className={`status-dot ${isRecording ? "status-dot--rec" : isReplaying ? "status-dot--play" : ""}`} role="status">
          <span aria-hidden="true" />
          {isRecording ? "Recording" : isReplaying ? "Ghost in control" : isDemoLoading || isImporting ? "Preparing session" : "Local session"}
        </div>
      </header>

      <section className="intro" aria-labelledby="app-title">
        <div className="intro-identity">
          <GhostMark className="intro-ghost" />
          <div><h1 className="app-title" id="app-title">GHOST DECK</h1><p className="app-subtitle">The night moves on. Keep the transition.</p></div>
        </div>
        <div className="intro-start">
          <p>Two tracks. Your moves. A ghost that plays them back.</p>
          <button type="button" className="btn btn-demo" onClick={() => void handleDemo()} disabled={isRecording || isReplaying || isTrackLoading || isImporting}>
            <GhostMark /> {isDemoLoading ? "Building your demo…" : "Load a demo session"}
          </button>
          <span>Original sounds, made in your browser. No files needed.</span>
        </div>
      </section>

      {confirmDemo && (
        <div className="demo-confirm" role="status">
          <p>The demo replaces both tracks and the current trace. Export your trace below if you want to keep it.</p>
          <button className="btn" onClick={() => void handleDemo()} disabled={isRecording || isReplaying || isTrackLoading || isImporting}>Replace with demo</button>
          <button className="btn btn-quiet" onClick={() => setConfirmDemo(false)}>Keep my session</button>
        </div>
      )}
      {runtimeError && <div className="app-error" role="alert">{runtimeError}</div>}

      <SessionGuide trackCount={trackCount} hasTrace={Boolean(trace)} isRecording={isRecording} isReplaying={isReplaying} />

      <main id="console">
        <div className="console-heading"><h2>The console</h2><span><i className="legend-a" /> Deck A <i className="legend-b" /> Deck B <i className="legend-ghost" /> Ghost</span></div>
        <div className="decks-row">
          <Deck
            id="A" engine={engine} bus={bus} track={loadedTracks.A}
            ghostGain={ghost.gainA} ghostFilter={ghost.filterA} ghostDelay={ghost.delayA} ghostReverb={ghost.reverbA}
            loadDisabled={isRecording || isReplaying || isDemoLoading || isImporting}
            controlsDisabled={isReplaying || isDemoLoading}
            onTrackLoaded={handleTrackLoaded} onLoadingChange={handleLoadingChange}
          />
          <div className="center-column">
            <div className={`mixer-emblem ${isReplaying ? "mixer-emblem--active" : ""}`}><GhostMark /><span>{isReplaying ? "Following the trace" : "Make it your own"}</span></div>
            <Crossfader engine={engine} bus={bus} ghostValue={ghost.crossfader} disabled={isReplaying || isDemoLoading} />
            <div className="mixer-note">Two decks.<br />One fleeting moment.</div>
            <details className="kb-hint" aria-label="Keyboard controls">
              <summary>Keyboard controls</summary>
              <div className="kb-hint-body">
                <div className="kb-hint-row"><kbd>Q</kbd>/<kbd>W</kbd> A play / pause</div>
                <div className="kb-hint-row"><kbd>O</kbd>/<kbd>P</kbd> B play / pause</div>
                <div className="kb-hint-row"><kbd>A</kbd>/<kbd>S</kbd> A gain − / +</div>
                <div className="kb-hint-row"><kbd>K</kbd>/<kbd>L</kbd> B gain − / +</div>
                <div className="kb-hint-row"><kbd>Z</kbd>/<kbd>X</kbd> A LPF − / +</div>
                <div className="kb-hint-row"><kbd>M</kbd>/<kbd>,</kbd> B LPF − / +</div>
                <div className="kb-hint-row"><kbd>←</kbd>/<kbd>→</kbd> crossfader</div>
                <div className="kb-hint-row"><kbd>Space</kbd> A toggle</div>
              </div>
            </details>
          </div>
          <Deck
            id="B" engine={engine} bus={bus} track={loadedTracks.B}
            ghostGain={ghost.gainB} ghostFilter={ghost.filterB} ghostDelay={ghost.delayB} ghostReverb={ghost.reverbB}
            loadDisabled={isRecording || isReplaying || isDemoLoading || isImporting}
            controlsDisabled={isReplaying || isDemoLoading}
            onTrackLoaded={handleTrackLoaded} onLoadingChange={handleLoadingChange}
          />
        </div>

        {demoReady && (
          <div className="demo-ready" role="status">
            <GhostMark /><div><strong>Your first ghost is ready.</strong><p>Hit Replay ghost for a 12-second transition. Then cue the tracks and record your own.</p></div>
            <span>120 BPM / Original demo</span>
          </div>
        )}

        <TransportControls
          trace={trace} isRecording={isRecording} isReplaying={isReplaying} isTrackLoading={isTrackLoading}
          recordingStats={recordingStats} replayIssue={replayIssue} trackMatches={trackMatches}
          allowMismatch={allowMismatch} onAllowMismatch={setAllowMismatch}
          onRecord={() => void handleRecord()} onStop={handleStop} onReplay={() => void handleReplay()}
          onClear={handleClear} onImport={handleImport} onImportLoadingChange={handleImportLoadingChange}
        />

        <TraceTimeline trace={trace} isReplaying={isReplaying} isRecording={isRecording} getReplayProgressMs={getReplayProgressMs} />
        <ReplayReportPanel report={replayOutcome} />
      </main>

      <footer className="app-footer">
        <span>GHOST DECK <small>v{APP_VERSION}</small></span>
        <p>Sound stays here. Audio never leaves your browser.<br /><span>Export your trace to keep it. Reloading clears this session.</span></p>
        <a href="https://www.notgoodcompany.com/radio" target="_blank" rel="noreferrer">From the world of Bad Company ↗</a>
      </footer>
    </div>
  );
}
