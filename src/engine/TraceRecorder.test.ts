import { describe, expect, it } from "vitest";
import { ControlBus, type ControlEvent } from "./ControlBus";
import type { EngineSnapshot } from "./AudioEngine";
import { TraceRecorder, type TraceSession } from "./TraceRecorder";
import type { LoadedTracks } from "./TrackIdentity";

const snapshot = (position = 0): EngineSnapshot => ({
  A: {
    isPlaying: position > 0,
    currentTime: position,
    duration: 60,
    gain: 0.75,
    filterFreq: 2_000,
    delayMix: 0.2,
    reverbMix: 0.1,
  },
  B: {
    isPlaying: false,
    currentTime: 3,
    duration: 90,
    gain: 1.1,
    filterFreq: 12_000,
    delayMix: 0,
    reverbMix: 0.3,
  },
  crossfader: 0.25,
});

const tracks: LoadedTracks = {
  A: { name: "a.wav", size: 100, mimeType: "audio/wav", durationSec: 60, sha256: "a".repeat(64) },
  B: { name: "b.wav", size: 200, mimeType: "audio/wav", durationSec: 90, sha256: "b".repeat(64) },
};

const event = (overrides: Partial<ControlEvent> = {}): ControlEvent => ({
  timestampMs: 100,
  deck: "A",
  control: "gain",
  value: 0.5,
  source: "mouse",
  ...overrides,
});

const session = (): TraceSession => ({
  version: 2,
  appVersion: "0.2.0",
  recordedAt: "2026-08-02T12:00:00.000Z",
  durationMs: 1_000,
  tracks: {
    A: { status: "known", identity: { ...tracks.A! } },
    B: { status: "known", identity: { ...tracks.B! } },
  },
  initialState: snapshot(2),
  finalState: snapshot(3),
  events: [event(), event({ timestampMs: 500, deck: "master", control: "crossfader", value: 0.8, source: "keyboard" })],
});

describe("TraceRecorder v2", () => {
  it("round-trips all portable replay context", () => {
    const original = session();
    const parsed = TraceRecorder.parseAndValidate(TraceRecorder.export(original));
    expect(parsed).toEqual(original);
  });

  it("migrates version 1 with a safe default state and unknown tracks", () => {
    const migrated = TraceRecorder.import({
      version: 1,
      recordedAt: "2025-01-01T00:00:00.000Z",
      events: [
        { timestampMs: 500, deck: "B", control: "gain", value: 0.9 },
        { timestampMs: 100, deck: "A", control: "play", value: 1 },
      ],
    });
    expect(migrated.version).toBe(2);
    expect(migrated.appVersion).toBe("0.1.0");
    expect(migrated.durationMs).toBe(500);
    expect(migrated.events.map((item) => item.timestampMs)).toEqual([100, 500]);
    expect(migrated.initialState.crossfader).toBe(0.5);
    expect(migrated.tracks.A.status).toBe("unknown");
    expect(migrated.tracks.B.status).toBe("unknown");
  });

  it("sorts stably, including identical timestamps", () => {
    const parsed = TraceRecorder.import({
      version: 1,
      events: [
        { timestampMs: 20, deck: "A", control: "gain", value: 0.2 },
        { timestampMs: 10, deck: "A", control: "gain", value: 0.1 },
        { timestampMs: 10, deck: "A", control: "gain", value: 0.15 },
      ],
    });
    expect(parsed.events.map((item) => item.value)).toEqual([0.1, 0.15, 0.2]);
  });

  it.each([
    ["target", { timestampMs: 1, deck: "C", control: "gain", value: 1 }],
    ["control", { timestampMs: 1, deck: "A", control: "tempo", value: 1 }],
    ["pair", { timestampMs: 1, deck: "master", control: "gain", value: 1 }],
    ["timestamp", { timestampMs: -1, deck: "A", control: "gain", value: 1 }],
    ["gain", { timestampMs: 1, deck: "A", control: "gain", value: 2 }],
    ["filter", { timestampMs: 1, deck: "A", control: "filter", value: 100 }],
    ["crossfader", { timestampMs: 1, deck: "master", control: "crossfader", value: 2 }],
  ])("rejects an invalid %s event", (_label, invalidEvent) => {
    expect(() => TraceRecorder.import({ version: 1, events: [invalidEvent] })).toThrow();
  });

  it("rejects a v2 duration earlier than its final event", () => {
    const raw = JSON.parse(TraceRecorder.export(session())) as Record<string, unknown>;
    raw.durationMs = 10;
    expect(() => TraceRecorder.import(raw)).toThrow(/durationMs/);
  });

  it("uses explicit start, stop, load, snapshot, serialize, and clear methods", () => {
    let now = 1_000;
    const bus = new ControlBus(() => now);
    const recorder = new TraceRecorder(bus);
    bus.resetClock();
    recorder.start(snapshot(1), tracks);
    now += 100;
    bus.dispatch("A", "gain", 0.4);
    now += 400;
    const captured = recorder.stop(snapshot(1.5));
    expect(captured?.durationMs).toBe(500);
    expect(captured?.events).toHaveLength(1);
    expect(captured?.initialState.A.currentTime).toBe(1);
    expect(captured?.finalState.A.currentTime).toBe(1.5);

    recorder.load(session());
    expect(recorder.snapshot()?.durationMs).toBe(1_000);
    expect(TraceRecorder.parseAndValidate(recorder.serialize()).events).toHaveLength(2);
    recorder.clear();
    expect(recorder.snapshot()).toBeNull();
    recorder.destroy();
  });
});
