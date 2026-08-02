import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hero from "./assets/hero.png";
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
  const [allowMismatch, setAllowMismatch] = useState(false);
  const [replayOutcome, setReplayOutcome] = useState<ReplayOutcome | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const keyboardRef = useRef<KeyboardController | null>(null);

  useEffect(() => {
    keyboardRef.current = new KeyboardController(bus, engine);
    return () => keyboardRef.current?.destroy();
  }, []);

  useEffect(() => {
    keyboardRef.current?.setEnabled(!isReplaying);
  }, [isReplaying]);

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

  const handleTrackLoaded = useCallback((deck: DeckId, track: TrackIdentity) => {
    setLoadedTracks((current) => ({ ...current, [deck]: track }));
    setRuntimeError("");
  }, []);

  const handleRecord = useCallback(async () => {
    if (isRecording || isReplaying) return;
    try {
      await engine.resume();
      const initialState = engine.getSnapshot();
      bus.resetClock();
      scheduler.reset();
      recorder.start(initialState, loadedTracks);
      setIsRecording(true);
      setTrace(null);
      setGhost({});
      setReplayOutcome(null);
      setAllowMismatch(false);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(`RECORD FAILED · ${(error as Error).message}`);
    }
  }, [isRecording, isReplaying, loadedTracks]);

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
  }, []);

  const handleStop = useCallback(() => {
    if (isRecording) {
      const captured = recorder.stop(engine.getSnapshot());
      setTrace(captured);
      setIsRecording(false);
      setReplayOutcome(null);
      return;
    }

    if (isReplaying) {
      const timing = scheduler.stop();
      const matches = trackMatches ?? { A: "unknown", B: "unknown" };
      if (timing) finishReplay(buildOutcome(timing, matches, false, allowMismatch));
    }
  }, [allowMismatch, buildOutcome, finishReplay, isRecording, isReplaying, trackMatches]);

  const handleReplay = useCallback(async () => {
    if (!trace || !trackMatches || replayIssue || scheduler.replaying) return;
    const matchesAtStart = { ...trackMatches };
    const overrideUsed = allowMismatch && (
      matchesAtStart.A === "mismatch" || matchesAtStart.B === "mismatch"
    );

    setIsReplaying(true);
    setReplayOutcome(null);
    setRuntimeError("");
    scheduler.reset();
    bus.setUserInputEnabled(false);

    try {
      await engine.resume();
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
      engine.stopAll();
      bus.setUserInputEnabled(true);
      setIsReplaying(false);
      setGhost({});
      setRuntimeError(`REPLAY FAILED · ${(error as Error).message}`);
    }
  }, [allowMismatch, buildOutcome, finishReplay, replayIssue, trace, trackMatches]);

  const handleClear = useCallback(() => {
    scheduler.reset();
    recorder.clear();
    setTrace(null);
    setGhost({});
    setReplayOutcome(null);
    setAllowMismatch(false);
    setRuntimeError("");
  }, []);

  const handleImport = useCallback((imported: TraceSession) => {
    scheduler.reset();
    recorder.load(imported);
    setTrace(imported);
    setGhost({});
    setReplayOutcome(null);
    setAllowMismatch(false);
    setRuntimeError("");
  }, []);

  const getReplayProgressMs = useCallback(() => scheduler.progressMs, []);

  return (
    <div className="app">
      <div className="crt-overlay" aria-hidden="true" />

      <header className="app-header">
        <img className="app-mark" src={hero} alt="" />
        <div>
          <div className="app-title">GHOST DECK</div>
          <div className="app-subtitle">THE TRANSITION TRACE IS THE INSTRUMENT</div>
        </div>
        <div
          className={`status-dot ${isRecording ? "status-dot--rec" : isReplaying ? "status-dot--play" : ""}`}
          role="status"
          aria-live="polite"
        >
          {isRecording ? "● REC" : isReplaying ? "◈ MEASURED REPLAY" : "○ READY"}
        </div>
      </header>

      {runtimeError && <div className="app-error" role="alert">{runtimeError}</div>}

      <main>
        <div className="decks-row">
          <Deck
            id="A"
            engine={engine}
            bus={bus}
            ghostGain={ghost.gainA}
            ghostFilter={ghost.filterA}
            ghostDelay={ghost.delayA}
            ghostReverb={ghost.reverbA}
            loadDisabled={isRecording || isReplaying}
            controlsDisabled={isReplaying}
            onTrackLoaded={handleTrackLoaded}
          />
          <div className="center-column">
            <Crossfader engine={engine} bus={bus} ghostValue={ghost.crossfader} disabled={isReplaying} />
            <div className="kb-hint" aria-label="Keyboard controls">
              <div className="kb-hint-title">KEYBOARD INPUT</div>
              <div className="kb-hint-row"><kbd>Q</kbd>/<kbd>W</kbd> A play / pause</div>
              <div className="kb-hint-row"><kbd>O</kbd>/<kbd>P</kbd> B play / pause</div>
              <div className="kb-hint-row"><kbd>A</kbd>/<kbd>S</kbd> A gain − / +</div>
              <div className="kb-hint-row"><kbd>K</kbd>/<kbd>L</kbd> B gain − / +</div>
              <div className="kb-hint-row"><kbd>Z</kbd>/<kbd>X</kbd> A LPF − / +</div>
              <div className="kb-hint-row"><kbd>M</kbd>/<kbd>,</kbd> B LPF − / +</div>
              <div className="kb-hint-row"><kbd>←</kbd>/<kbd>→</kbd> crossfader</div>
              <div className="kb-hint-row"><kbd>Space</kbd> A toggle</div>
            </div>
          </div>
          <Deck
            id="B"
            engine={engine}
            bus={bus}
            ghostGain={ghost.gainB}
            ghostFilter={ghost.filterB}
            ghostDelay={ghost.delayB}
            ghostReverb={ghost.reverbB}
            loadDisabled={isRecording || isReplaying}
            controlsDisabled={isReplaying}
            onTrackLoaded={handleTrackLoaded}
          />
        </div>

        <TraceTimeline trace={trace} isReplaying={isReplaying} getReplayProgressMs={getReplayProgressMs} />

        <TransportControls
          trace={trace}
          isRecording={isRecording}
          isReplaying={isReplaying}
          replayIssue={replayIssue}
          trackMatches={trackMatches}
          allowMismatch={allowMismatch}
          onAllowMismatch={setAllowMismatch}
          onRecord={() => void handleRecord()}
          onStop={handleStop}
          onReplay={() => void handleReplay()}
          onClear={handleClear}
          onImport={handleImport}
        />

        <ReplayReportPanel report={replayOutcome} />
      </main>

      <footer className="app-footer">
        GHOST DECK v{APP_VERSION} · AUDIO + TRACES STAY IN YOUR BROWSER · NO BACKEND / UPLOAD / TELEMETRY
      </footer>
    </div>
  );
}
