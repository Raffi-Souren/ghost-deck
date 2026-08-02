/**
 * ReplayScheduler
 * Replays a recorded trace against a live AudioEngine.
 * Scheduling uses a combination of AudioContext.currentTime (for audio nodes)
 * and setTimeout (for UI/state callbacks).
 */

import type { TraceEvent } from "./TraceRecorder";
import type { AudioEngine, DeckId } from "./AudioEngine";

export type ReplayCallback = (event: TraceEvent) => void;

export class ReplayScheduler {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private _replaying = false;

  get replaying() {
    return this._replaying;
  }

  /**
   * Schedule all events.
   * @param events  Recorded trace events (timestampMs offsets from 0)
   * @param engine  Live AudioEngine instance
   * @param onEvent Called on the UI thread just before each event fires (for ghost overlay updates)
   * @param onDone  Called when the last event has fired
   */
  start(
    events: TraceEvent[],
    engine: AudioEngine,
    onEvent: ReplayCallback,
    onDone: () => void
  ) {
    this.stop(); // clear any previous replay
    if (events.length === 0) {
      onDone();
      return;
    }

    this._replaying = true;
    const wallStart = performance.now();

    events.forEach((evt, idx) => {
      const timer = setTimeout(() => {
        if (!this._replaying) return;

        // Apply to audio engine
        this._applyEvent(evt, engine);

        // Notify UI
        onEvent(evt);

        if (idx === events.length - 1) {
          this._replaying = false;
          onDone();
        }
      }, evt.timestampMs);
      this.timers.push(timer);
    });

    // Suppress "wallStart unused" lint – it's here for future drift correction
    void wallStart;
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this._replaying = false;
  }

  private _applyEvent(evt: TraceEvent, engine: AudioEngine) {
    const deck = evt.deck as DeckId; // "A" | "B" – master handled separately

    switch (evt.control) {
      case "play":
        engine.play(deck);
        break;
      case "pause":
        engine.pause(deck);
        break;
      case "seek":
        engine.seek(deck, evt.value);
        break;
      case "gain":
        engine.setGain(deck, evt.value);
        break;
      case "filter":
        engine.setFilter(deck, evt.value);
        break;
      case "crossfader":
        engine.setCrossfader(evt.value);
        break;
    }
  }
}
