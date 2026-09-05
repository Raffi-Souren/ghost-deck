import { describe, expect, it, vi } from "vitest";
import type { AudioEngine, EngineSnapshot } from "./AudioEngine";
import { DEMO_DURATION_SEC, generateDemoWav, loadDemoSession } from "./DemoSession";
import { classifyTracks, sha256Hex } from "./TrackIdentity";
import { TraceRecorder } from "./TraceRecorder";

describe("generated demo session", () => {
  it.each(["A", "B"] as const)("generates a stable, quiet 16-second PCM WAV for deck %s", async (deck) => {
    const buffer = generateDemoWav(deck);
    const view = new DataView(buffer);
    const textAt = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(buffer, offset, length));
    expect(textAt(0, 4)).toBe("RIFF");
    expect(textAt(8, 4)).toBe("WAVE");
    expect(textAt(12, 4)).toBe("fmt ");
    expect(textAt(36, 4)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(buffer.byteLength - 44);
    const sampleRate = view.getUint32(24, true);
    expect(view.getUint32(28, true)).toBe(sampleRate * 2);
    expect(view.getUint32(40, true) / 2 / sampleRate).toBe(DEMO_DURATION_SEC);

    let peak = 0;
    let sumSquares = 0;
    const sampleCount = (buffer.byteLength - 44) / 2;
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = view.getInt16(44 + index * 2, true) / 0x7fff;
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
    }
    expect(peak).toBeLessThan(0.61);
    expect(Math.sqrt(sumSquares / sampleCount)).toBeGreaterThan(0.01);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(buffer.byteLength - 2, true)).toBe(0);
    const hash = await sha256Hex(buffer);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await sha256Hex(generateDemoWav(deck))).toBe(hash);
  });

  it("fingerprints before decoding, loads both parts, and leaves playback to the caller", async () => {
    const hashes: string[] = [];
    const loadBuffer = vi.fn(async (_deck: string, buffer: ArrayBuffer) => {
      hashes.push((await sha256Hex(buffer))!);
      structuredClone(buffer, { transfer: [buffer] });
    });
    const engine = { loadBuffer, applySnapshot: vi.fn(), play: vi.fn() };
    const { tracks, trace } = await loadDemoSession(engine as unknown as AudioEngine);
    expect(loadBuffer.mock.calls.map(([deck]) => deck)).toEqual(["A", "B"]);
    expect(engine.applySnapshot).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(tracks.A?.sha256).toBe(hashes[0]);
    expect(tracks.B?.sha256).toBe(hashes[1]);
    expect(tracks.A?.sha256).not.toBe(tracks.B?.sha256);
    expect(tracks.A?.size).toBe(44 + 44_100 * DEMO_DURATION_SEC * 2);
    expect(classifyTracks(trace.tracks, tracks)).toEqual({ A: "match", B: "match" });
    expect(TraceRecorder.parseAndValidate(TraceRecorder.export(trace))).toEqual(trace);

    const state: EngineSnapshot = structuredClone(trace.initialState);
    expect(state.A).toMatchObject({ currentTime: 0, isPlaying: true, gain: 0.85 });
    expect(state.B).toMatchObject({ currentTime: 0, isPlaying: true, gain: 0.85 });
    expect(state.crossfader).toBe(0);
    let timestamp = 0;
    let previousCrossfader = 0;
    for (const event of trace.events) {
      expect(event.timestampMs).toBeGreaterThanOrEqual(timestamp);
      timestamp = event.timestampMs;
      if (event.deck === "master") {
        expect(event.value).toBeGreaterThanOrEqual(previousCrossfader);
        expect(event.value - previousCrossfader).toBeLessThan(0.025);
        previousCrossfader = event.value;
        state.crossfader = event.value;
      } else if (event.control === "filter") state[event.deck].filterFreq = event.value;
      else if (event.control === "delay") state[event.deck].delayMix = event.value;
      else throw new Error(`Unexpected demo control: ${event.control}`);
    }
    expect(trace.durationMs).toBe(12_000);
    expect(timestamp).toBeLessThan(trace.durationMs);
    state.A.currentTime += trace.durationMs / 1_000;
    state.B.currentTime += trace.durationMs / 1_000;
    expect(state).toEqual(trace.finalState);
  });

  it("reports a successful deck replacement even when the next deck fails to decode", async () => {
    let loadedHash: string | undefined;
    const loadBuffer = vi.fn(async (deck: string, buffer: ArrayBuffer) => {
      if (deck === "B") throw new Error("Could not decode deck B");
      loadedHash = await sha256Hex(buffer);
      structuredClone(buffer, { transfer: [buffer] });
    });
    const onTrackLoaded = vi.fn();

    await expect(loadDemoSession({ loadBuffer } as unknown as AudioEngine, onTrackLoaded))
      .rejects.toThrow("Could not decode deck B");

    expect(loadBuffer.mock.calls.map(([deck]) => deck)).toEqual(["A", "B"]);
    expect(onTrackLoaded).toHaveBeenCalledExactlyOnceWith("A", {
      name: "Night Drive — drums & bass.wav",
      size: 44 + 44_100 * DEMO_DURATION_SEC * 2,
      mimeType: "audio/wav",
      durationSec: DEMO_DURATION_SEC,
      sha256: loadedHash,
    });
  });
});
