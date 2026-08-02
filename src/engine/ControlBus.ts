/**
 * ControlBus
 *
 * Single dispatch layer for ALL control events — exactly like Mixxx's
 * internal control API. Every input source (mouse, keyboard, MIDI, ghost
 * replay) calls dispatch(). Every consumer (AudioEngine, TraceRecorder,
 * UI ghost overlay) subscribes.
 *
 * This means GhostReplay is just another controller, not a special bolt-on.
 */

import { clamp, MAX_DECK_GAIN, MAX_FILTER_HZ, MIN_FILTER_HZ } from "./AudioMath";

export type DeckId    = "A" | "B";
export type TargetId  = DeckId | "master";
export type SourceId  = "mouse" | "keyboard" | "ghost" | "internal";

export type ControlName =
  | "play"
  | "pause"
  | "seek"
  | "gain"
  | "filter"
  | "delay"
  | "reverb"
  | "crossfader";

export interface ControlEvent {
  timestampMs: number;  // performance.now() offset from session start
  deck:        TargetId;
  control:     ControlName;
  value:       number;  // normalised: 0/1 play/pause, seconds seek, 0-1 gain/xfade, Hz filter
  source:      SourceId;
}

type Listener = (evt: ControlEvent) => void;

function normaliseValue(control: ControlName, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  switch (control) {
    case "play":
      return 1;
    case "pause":
      return 0;
    case "seek":
      return Math.max(0, value);
    case "gain":
      return clamp(value, 0, MAX_DECK_GAIN);
    case "filter":
      return clamp(value, MIN_FILTER_HZ, MAX_FILTER_HZ);
    case "delay":
    case "reverb":
      return clamp(value, 0, 1);
    case "crossfader":
      return clamp(value, 0, 1);
  }
}

function targetMatchesControl(deck: TargetId, control: ControlName): boolean {
  return control === "crossfader" ? deck === "master" : deck === "A" || deck === "B";
}

export class ControlBus {
  private listeners = new Set<Listener>();
  private readonly now: () => number;
  private sessionStart: number;
  private userInputEnabled = true;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.sessionStart = now();
  }

  /** Reset the session-start clock (call at start of a new recording). */
  resetClock() {
    this.sessionStart = this.now();
  }

  /** Current elapsed ms since last resetClock(). */
  elapsedMs(): number {
    return this.now() - this.sessionStart;
  }

  /** Lock mouse/keyboard input while deterministic ghost replay is active. */
  setUserInputEnabled(enabled: boolean) {
    this.userInputEnabled = enabled;
  }

  /**
   * Dispatch a control event to all subscribers.
   * Adds timestampMs automatically if not provided.
   */
  dispatch(
    deck:    TargetId,
    control: ControlName,
    value:   number,
    source:  SourceId = "mouse"
  ): boolean {
    if (!this.userInputEnabled && (source === "mouse" || source === "keyboard")) {
      return false;
    }

    const normalisedValue = normaliseValue(control, value);
    if (normalisedValue === null || !targetMatchesControl(deck, control)) return false;

    const evt: ControlEvent = {
      timestampMs: Math.round(this.elapsedMs()),
      deck,
      control,
      value: normalisedValue,
      source,
    };
    for (const fn of [...this.listeners]) fn(evt);
    return true;
  }

  /**
   * Dispatch a pre-built event (used by ReplayScheduler which preserves
   * original timestamps).
   */
  dispatchEvent(evt: ControlEvent): boolean {
    const value = normaliseValue(evt.control, evt.value);
    if (
      value === null ||
      !targetMatchesControl(evt.deck, evt.control) ||
      !Number.isFinite(evt.timestampMs) ||
      evt.timestampMs < 0
    ) {
      return false;
    }
    const normalised = { ...evt, timestampMs: Math.round(evt.timestampMs), value };
    for (const fn of [...this.listeners]) fn(normalised);
    return true;
  }

  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Subscribe to a specific deck+control combination.
   * Returns an unsubscribe function.
   */
  on(
    deck:    TargetId | "*",
    control: ControlName | "*",
    fn:      Listener
  ): () => void {
    const wrapper: Listener = (evt) => {
      if (deck    !== "*" && evt.deck    !== deck)    return;
      if (control !== "*" && evt.control !== control) return;
      fn(evt);
    };
    return this.subscribe(wrapper);
  }
}
