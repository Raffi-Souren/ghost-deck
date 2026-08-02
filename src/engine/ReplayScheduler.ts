/** Absolute-clock ghost replay with measured dispatch drift. */

import type { ControlBus, ControlEvent } from "./ControlBus";
import type { TraceSession } from "./TraceRecorder";
import {
  calculateReplayReport,
  type ReplayEventResult,
  type ReplayTimingReport,
} from "./ReplayMetrics";

export interface ReplaySchedulerOptions {
  clock?: () => number;
  tickIntervalMs?: number;
  onDone: (report: ReplayTimingReport) => void;
}

interface ActiveReplay {
  events: ControlEvent[];
  durationMs: number;
  bus: ControlBus;
  clock: () => number;
  tickIntervalMs: number;
  onDone: (report: ReplayTimingReport) => void;
  startedAtMs: number;
  cursor: number;
  results: ReplayEventResult[];
}

export class ReplayScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active: ActiveReplay | null = null;
  private lastProgressMs = 0;

  get replaying() {
    return this.active !== null;
  }

  get progressMs() {
    if (!this.active) return this.lastProgressMs;
    return Math.min(
      this.active.durationMs,
      Math.max(0, this.active.clock() - this.active.startedAtMs),
    );
  }

  start(
    trace: Pick<TraceSession, "events" | "durationMs">,
    bus: ControlBus,
    options: ReplaySchedulerOptions,
  ) {
    this.stop();

    const clock = options.clock ?? (() => performance.now());
    const events = trace.events
      .map((event, index) => ({ event: { ...event }, index }))
      .sort((a, b) => a.event.timestampMs - b.event.timestampMs || a.index - b.index)
      .map(({ event }) => event);
    const finalEventMs = events.at(-1)?.timestampMs ?? 0;

    this.lastProgressMs = 0;
    this.active = {
      events,
      durationMs: Math.max(trace.durationMs, finalEventMs),
      bus,
      clock,
      tickIntervalMs: Math.max(4, options.tickIntervalMs ?? 20),
      onDone: options.onDone,
      startedAtMs: clock(),
      cursor: 0,
      results: [],
    };

    this.tick();
  }

  stop(): ReplayTimingReport | null {
    if (!this.active) return null;
    return this.finish("interrupted", false);
  }

  reset() {
    this.stop();
    this.lastProgressMs = 0;
  }

  private tick = () => {
    const active = this.active;
    if (!active) return;

    const elapsedMs = Math.max(0, active.clock() - active.startedAtMs);
    this.lastProgressMs = Math.min(active.durationMs, elapsedMs);

    while (
      active.cursor < active.events.length &&
      active.events[active.cursor].timestampMs <= elapsedMs
    ) {
      const index = active.cursor;
      const event = active.events[index];
      active.bus.dispatchEvent({ ...event, source: "ghost" });
      const actualTimestampMs = Math.max(0, active.clock() - active.startedAtMs);
      active.results.push({
        eventIndex: index,
        targetTimestampMs: event.timestampMs,
        actualTimestampMs,
        driftMs: actualTimestampMs - event.timestampMs,
      });
      active.cursor += 1;
    }

    if (active.cursor >= active.events.length && elapsedMs >= active.durationMs) {
      this.finish("completed", true);
      return;
    }

    const nextEventMs = active.events[active.cursor]?.timestampMs ?? active.durationMs;
    const nextTargetMs = Math.min(nextEventMs, active.durationMs);
    const delayMs = Math.max(0, Math.min(active.tickIntervalMs, nextTargetMs - elapsedMs));
    this.timer = setTimeout(this.tick, delayMs);
  };

  private finish(status: "completed" | "interrupted", notify: boolean): ReplayTimingReport {
    const active = this.active;
    if (!active) throw new Error("No replay is active");
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const actualDurationMs = Math.max(0, active.clock() - active.startedAtMs);
    this.lastProgressMs = Math.min(active.durationMs, actualDurationMs);
    const report = calculateReplayReport(
      status,
      active.events.length,
      active.durationMs,
      actualDurationMs,
      active.results,
    );
    const onDone = active.onDone;
    this.active = null;
    if (notify) onDone(report);
    return report;
  }
}
