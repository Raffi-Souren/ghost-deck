import { describe, expect, it } from "vitest";
import { ControlBus, type ControlEvent } from "./ControlBus";
import { TraceRecorder } from "./TraceRecorder";
import type { EngineSnapshot } from "./AudioEngine";

describe("ControlBus", () => {
  it("timestamps, normalises, and publishes controls", () => {
    let now = 50;
    const bus = new ControlBus(() => now);
    const received: ControlEvent[] = [];
    bus.subscribe((item) => received.push(item));
    bus.resetClock();
    now = 75;
    expect(bus.dispatch("A", "gain", 9)).toBe(true);
    expect(received[0]).toMatchObject({ timestampMs: 25, deck: "A", control: "gain", value: 1.5 });
    expect(bus.dispatch("master", "gain", 1)).toBe(false);
  });

  it("locks user sources while allowing ghost and internal events", () => {
    const bus = new ControlBus(() => 0);
    const sources: string[] = [];
    bus.subscribe((item) => sources.push(item.source));
    bus.setUserInputEnabled(false);
    expect(bus.dispatch("A", "gain", 1, "mouse")).toBe(false);
    expect(bus.dispatch("A", "gain", 1, "keyboard")).toBe(false);
    expect(bus.dispatch("A", "gain", 1, "ghost")).toBe(true);
    expect(bus.dispatch("A", "gain", 1, "internal")).toBe(true);
    expect(sources).toEqual(["ghost", "internal"]);
  });

  it("unsubscribes cleanly", () => {
    const bus = new ControlBus(() => 0);
    let calls = 0;
    const unsubscribe = bus.subscribe(() => { calls += 1; });
    bus.dispatch("A", "gain", 1);
    unsubscribe();
    bus.dispatch("A", "gain", 1);
    expect(calls).toBe(1);
  });

  it("does not re-record ghost or internal events", () => {
    let now = 0;
    const bus = new ControlBus(() => now);
    const recorder = new TraceRecorder(bus);
    const deck = {
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      gain: 1,
      filterFreq: 20_000,
      delayMix: 0,
      reverbMix: 0,
    };
    const snapshot: EngineSnapshot = { A: { ...deck }, B: { ...deck }, crossfader: 0.5 };
    recorder.start(snapshot, { A: null, B: null });
    now = 10;
    bus.dispatch("A", "gain", 0.5, "mouse");
    bus.dispatchEvent({ timestampMs: 20, deck: "A", control: "gain", value: 0.6, source: "ghost" });
    bus.dispatch("A", "filter", 2_000, "internal");
    const captured = recorder.stop(snapshot);
    expect(captured?.events).toHaveLength(1);
    expect(captured?.events[0].source).toBe("mouse");
    recorder.destroy();
  });
});
