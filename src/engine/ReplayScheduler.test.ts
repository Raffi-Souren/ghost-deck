import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlBus, type ControlEvent } from "./ControlBus";
import { ReplayScheduler } from "./ReplayScheduler";

const event = (timestampMs: number, value: number): ControlEvent => ({
  timestampMs,
  deck: "A",
  control: "gain",
  value,
  source: "mouse",
});

describe("ReplayScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches sorted, stable ghost events and completes at trace duration", () => {
    const bus = new ControlBus(() => Date.now());
    const scheduler = new ReplayScheduler();
    const received: ControlEvent[] = [];
    const onDone = vi.fn();
    bus.subscribe((item) => received.push(item));

    scheduler.start(
      { events: [event(100, 0.3), event(50, 0.1), event(50, 0.2)], durationMs: 1_000 },
      bus,
      { clock: () => Date.now(), onDone },
    );

    vi.advanceTimersByTime(100);
    expect(received.map((item) => item.value)).toEqual([0.1, 0.2, 0.3]);
    expect(received.every((item) => item.source === "ghost")).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(899);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({
      status: "completed",
      expectedEvents: 3,
      appliedEvents: 3,
      traceDurationMs: 1_000,
    });
  });

  it("honors duration for an empty trace", () => {
    const scheduler = new ReplayScheduler();
    const onDone = vi.fn();
    scheduler.start(
      { events: [], durationMs: 200 },
      new ControlBus(() => Date.now()),
      { clock: () => Date.now(), onDone },
    );
    vi.advanceTimersByTime(199);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("cancels cleanly and reports interruption", () => {
    const scheduler = new ReplayScheduler();
    const bus = new ControlBus(() => Date.now());
    const received: ControlEvent[] = [];
    const onDone = vi.fn();
    bus.subscribe((item) => received.push(item));
    scheduler.start(
      { events: [event(100, 0.5)], durationMs: 1_000 },
      bus,
      { clock: () => Date.now(), onDone },
    );
    vi.advanceTimersByTime(50);
    const report = scheduler.stop();
    vi.advanceTimersByTime(2_000);
    expect(report?.status).toBe("interrupted");
    expect(received).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("restarting cancels the previous run", () => {
    const scheduler = new ReplayScheduler();
    const bus = new ControlBus(() => Date.now());
    const firstDone = vi.fn();
    const secondDone = vi.fn();
    scheduler.start(
      { events: [event(500, 0.5)], durationMs: 500 },
      bus,
      { clock: () => Date.now(), onDone: firstDone },
    );
    scheduler.start(
      { events: [], durationMs: 10 },
      bus,
      { clock: () => Date.now(), onDone: secondDone },
    );
    vi.advanceTimersByTime(1_000);
    expect(firstDone).not.toHaveBeenCalled();
    expect(secondDone).toHaveBeenCalledTimes(1);
  });
});
