/**
 * TraceRecorder
 * Records every user control action with a wall-clock timestamp.
 */

export type DeckId = "A" | "B";
export type TargetId = DeckId | "master";

export type ControlName =
  | "play"
  | "pause"
  | "seek"
  | "gain"
  | "filter"
  | "crossfader";

export interface TraceEvent {
  timestampMs: number;
  deck: TargetId;
  control: ControlName;
  value: number; // normalised: 0/1 for play/pause, seconds for seek, 0-1 for gain/xfade, Hz for filter
}

export interface TraceFile {
  version: 1;
  recordedAt: string; // ISO date
  events: TraceEvent[];
}

export class TraceRecorder {
  private events: TraceEvent[] = [];
  private startWall = 0;
  private _recording = false;

  get recording() {
    return this._recording;
  }

  start() {
    this.events = [];
    this.startWall = performance.now();
    this._recording = true;
  }

  stop(): TraceEvent[] {
    this._recording = false;
    return [...this.events];
  }

  record(deck: TargetId, control: ControlName, value: number) {
    if (!this._recording) return;
    this.events.push({
      timestampMs: Math.round(performance.now() - this.startWall),
      deck,
      control,
      value,
    });
  }

  /** Return a snapshot of current events without stopping. */
  peek(): TraceEvent[] {
    return [...this.events];
  }

  /** Serialise to downloadable JSON blob. */
  export(): string {
    const file: TraceFile = {
      version: 1,
      recordedAt: new Date().toISOString(),
      events: [...this.events],
    };
    return JSON.stringify(file, null, 2);
  }

  /** Import from a parsed JSON object; throws if invalid. */
  static import(raw: unknown): TraceEvent[] {
    if (
      typeof raw !== "object" ||
      raw === null ||
      (raw as TraceFile).version !== 1 ||
      !Array.isArray((raw as TraceFile).events)
    ) {
      throw new Error("Invalid trace file format");
    }
    return (raw as TraceFile).events;
  }
}
