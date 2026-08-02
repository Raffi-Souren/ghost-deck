import { describe, expect, it } from "vitest";
import {
  classifyTrackMatch,
  classifyTracks,
  knownTrackReferences,
  overallTrackMatch,
  unknownTrackReferences,
  type TrackIdentity,
} from "./TrackIdentity";

const track = (overrides: Partial<TrackIdentity> = {}): TrackIdentity => ({
  name: "track.wav",
  size: 1024,
  mimeType: "audio/wav",
  durationSec: 42,
  ...overrides,
});

describe("track identity", () => {
  it("classifies unknown, missing, and no-track references", () => {
    expect(classifyTrackMatch({ status: "unknown", identity: null }, null)).toBe("unknown");
    expect(classifyTrackMatch({ status: "known", identity: track() }, null)).toBe("missing");
    expect(classifyTrackMatch({ status: "known", identity: null }, track())).toBe("match");
  });

  it("prefers SHA-256 when both sides have one", () => {
    const sha256 = "a".repeat(64);
    expect(classifyTrackMatch(
      { status: "known", identity: track({ sha256 }) },
      track({ name: "renamed.wav", sha256 }),
    )).toBe("match");
    expect(classifyTrackMatch(
      { status: "known", identity: track({ sha256 }) },
      track({ sha256: "b".repeat(64) }),
    )).toBe("mismatch");
  });

  it("uses metadata and duration tolerance when hashes are absent", () => {
    expect(classifyTrackMatch(
      { status: "known", identity: track() },
      track({ durationSec: 42.2 }),
    )).toBe("match");
    expect(classifyTrackMatch(
      { status: "known", identity: track() },
      track({ durationSec: 42.3 }),
    )).toBe("mismatch");
    expect(classifyTrackMatch(
      { status: "known", identity: track() },
      track({ mimeType: "audio/mpeg" }),
    )).toBe("mismatch");
  });

  it("classifies both decks and produces an overall status", () => {
    const expected = knownTrackReferences({ A: track(), B: track({ name: "b.wav" }) });
    const matches = classifyTracks(expected, { A: track(), B: null });
    expect(matches).toEqual({ A: "match", B: "missing" });
    expect(overallTrackMatch(matches)).toBe("missing");
    expect(overallTrackMatch({ A: "unknown", B: "match" })).toBe("unknown");
    expect(unknownTrackReferences().A.status).toBe("unknown");
  });
});
