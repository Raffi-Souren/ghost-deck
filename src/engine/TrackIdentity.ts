import type { DeckId } from "./ControlBus";

export interface TrackIdentity {
  name: string;
  size: number;
  mimeType: string;
  durationSec: number;
  sha256?: string;
}

export type TraceTrackReference =
  | { status: "known"; identity: TrackIdentity | null }
  | { status: "unknown"; identity: null };

export type TraceTracks = Record<DeckId, TraceTrackReference>;
export type LoadedTracks = Record<DeckId, TrackIdentity | null>;
export type TrackMatchStatus = "match" | "missing" | "mismatch" | "unknown";
export type TrackMatches = Record<DeckId, TrackMatchStatus>;

export async function sha256Hex(buffer: ArrayBuffer): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function classifyTrackMatch(
  expected: TraceTrackReference,
  loaded: TrackIdentity | null,
): TrackMatchStatus {
  if (expected.status === "unknown") return "unknown";
  if (expected.identity === null) return "match";
  if (loaded === null) return "missing";

  if (expected.identity.sha256 && loaded.sha256) {
    return expected.identity.sha256 === loaded.sha256 ? "match" : "mismatch";
  }

  const durationMatches = Math.abs(expected.identity.durationSec - loaded.durationSec) <= 0.25;
  const sizeMatches = expected.identity.size === loaded.size;
  const nameMatches = expected.identity.name === loaded.name;
  const mimeMatches = expected.identity.mimeType === loaded.mimeType;
  return durationMatches && sizeMatches && nameMatches && mimeMatches ? "match" : "mismatch";
}

export function classifyTracks(expected: TraceTracks, loaded: LoadedTracks): TrackMatches {
  return {
    A: classifyTrackMatch(expected.A, loaded.A),
    B: classifyTrackMatch(expected.B, loaded.B),
  };
}

export function overallTrackMatch(matches: TrackMatches): TrackMatchStatus {
  if (matches.A === "mismatch" || matches.B === "mismatch") return "mismatch";
  if (matches.A === "missing" || matches.B === "missing") return "missing";
  if (matches.A === "unknown" || matches.B === "unknown") return "unknown";
  return "match";
}

export function knownTrackReferences(tracks: LoadedTracks): TraceTracks {
  return {
    A: { status: "known", identity: tracks.A ? { ...tracks.A } : null },
    B: { status: "known", identity: tracks.B ? { ...tracks.B } : null },
  };
}

export function unknownTrackReferences(): TraceTracks {
  return {
    A: { status: "unknown", identity: null },
    B: { status: "unknown", identity: null },
  };
}
