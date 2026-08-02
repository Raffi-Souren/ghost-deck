/**
 * App — root component
 * Wires AudioEngine, TraceRecorder, and ReplayScheduler together.
 */

import { useState, useCallback } from "react";
import { AudioEngine } from "./engine/AudioEngine";
import { TraceRecorder } from "./engine/TraceRecorder";
import { ReplayScheduler } from "./engine/ReplayScheduler";
import type { TraceEvent } from "./engine/TraceRecorder";
import { Deck } from "./components/Deck";
import { Crossfader } from "./components/Crossfader";
import { TransportControls } from "./components/TransportControls";

// Singleton instances – stable across renders
const engine = new AudioEngine();
const recorder = new TraceRecorder();
const scheduler = new ReplayScheduler();

interface GhostState {
  gainA?: number;
  gainB?: number;
  filterA?: number;
  filterB?: number;
  crossfader?: number;
}

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [ghost, setGhost] = useState<GhostState>({});

  // ── Transport handlers ────────────────────────────────────────────────
  const handleRecord = useCallback(() => {
    engine.resume();
    recorder.start();
    setIsRecording(true);
    setEvents([]);
  }, []);

  const handleStop = useCallback(() => {
    if (isRecording) {
      const captured = recorder.stop();
      setEvents(captured);
      setIsRecording(false);
    }
    if (isReplaying) {
      scheduler.stop();
      setIsReplaying(false);
      setGhost({});
    }
  }, [isRecording, isReplaying]);

  const handleReplay = useCallback(() => {
    if (events.length === 0) return;
    engine.resetAll();
    setGhost({});
    setIsReplaying(true);

    scheduler.start(
      events,
      engine,
      // onEvent — update ghost overlay
      (evt) => {
        setGhost((prev) => {
          const next = { ...prev };
          if (evt.deck === "A") {
            if (evt.control === "gain") next.gainA = evt.value;
            if (evt.control === "filter") next.filterA = evt.value;
          }
          if (evt.deck === "B") {
            if (evt.control === "gain") next.gainB = evt.value;
            if (evt.control === "filter") next.filterB = evt.value;
          }
          if (evt.control === "crossfader") next.crossfader = evt.value;
          return next;
        });
      },
      // onDone
      () => {
        setIsReplaying(false);
        setGhost({});
      }
    );
  }, [events]);

  const handleClear = useCallback(() => {
    setEvents([]);
    setGhost({});
    recorder.stop();
  }, []);

  const handleImport = useCallback((imported: TraceEvent[]) => {
    // Patch the recorder's internal events by stopping and re-starting,
    // then pushing imported events via peek proxy trick — simplest approach:
    recorder.stop();
    // We can't directly set recorder events from outside, so we
    // seed from the imported array by setting our state events directly.
    setEvents(imported);
    // Also make the recorder aware for export:
    (recorder as unknown as { events: TraceEvent[] }).events = imported;
  }, []);

  return (
    <div className="app">
      {/* CRT scanlines overlay */}
      <div className="crt-overlay" aria-hidden="true" />

      {/* Header */}
      <header className="app-header">
        <div className="app-title">GHOST DECK</div>
        <div className="app-subtitle">REPLAY THE SET</div>
        <div className={`status-dot ${isRecording ? "status-dot--rec" : isReplaying ? "status-dot--play" : ""}`}>
          {isRecording ? "● REC" : isReplaying ? "◈ GHOST" : "○ READY"}
        </div>
      </header>

      {/* Decks */}
      <div className="decks-row">
        <Deck
          id="A"
          engine={engine}
          recorder={recorder}
          ghostGain={ghost.gainA}
          ghostFilter={ghost.filterA}
        />
        <div className="center-column">
          <Crossfader
            engine={engine}
            recorder={recorder}
            ghostValue={ghost.crossfader}
          />
        </div>
        <Deck
          id="B"
          engine={engine}
          recorder={recorder}
          ghostGain={ghost.gainB}
          ghostFilter={ghost.filterB}
        />
      </div>

      {/* Transport */}
      <TransportControls
        recorder={recorder}
        isRecording={isRecording}
        isReplaying={isReplaying}
        events={events}
        onRecord={handleRecord}
        onStop={handleStop}
        onReplay={handleReplay}
        onClear={handleClear}
        onImport={handleImport}
      />

      <footer className="app-footer">
        GHOST DECK v0.1 · LOCAL PROCESSING ONLY · NO DATA LEAVES THIS MACHINE
      </footer>
    </div>
  );
}
