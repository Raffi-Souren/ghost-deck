/**
 * TraceRecorder
 *
 * Captures user ControlBus events plus the state that existed when REC was
 * pressed. Version 2 traces also store the real REC-to-STOP duration, so replay
 * neither starts from hard-coded defaults nor ends at the final gesture.
 */

import type { ControlBus, ControlEvent, ControlName, SourceId, TargetId } from "./ControlBus";
import type { DeckState, EngineSnapshot } from "./AudioEngine";
import type { LoadedTracks, TraceTrackReference, TraceTracks, TrackIdentity } from "./TrackIdentity";
import { knownTrackReferences, unknownTrackReferences } from "./TrackIdentity";
import { APP_VERSION } from "../version";

export type { ControlEvent as TraceEvent };

export const TRACE_VERSION = 2 as const;
export const MAX_TRACE_EVENTS = 100_000;
export const MAX_TRACE_DURATION_MS = 4 * 60 * 60 * 1000;
export const MAX_TRACE_FILE_BYTES = 5 * 1024 * 1024;

export interface TraceSession {
  version: typeof TRACE_VERSION;
  appVersion: string;
  recordedAt: string;
  durationMs: number;
  tracks: TraceTracks;
  initialState: EngineSnapshot;
  finalState: EngineSnapshot;
  events: ControlEvent[];
}

interface SerializedEvent {
  timestampMs: number;
  deck: TargetId;
  control: ControlName;
  value: number;
  source?: Extract<SourceId, "mouse" | "keyboard">;
}

interface TraceFileV1 {
  version: 1;
  recordedAt?: string;
  events: unknown[];
}

interface TraceFileV2 {
  version: typeof TRACE_VERSION;
  appVersion: string;
  recordedAt: string;
  durationMs: number;
  tracks: TraceTracks;
  initialState: EngineSnapshot;
  finalState: EngineSnapshot;
  events: SerializedEvent[];
}

const DECK_CONTROLS = new Set<ControlName>([
  "play",
  "pause",
  "seek",
  "gain",
  "filter",
  "delay",
  "reverb",
]);
const USER_SOURCES = new Set<SourceId>(["mouse", "keyboard"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function inRange(value: number, min: number, max: number, label: string): number {
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function validateDeckState(raw: unknown, label: string): DeckState {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);

  const duration = inRange(finiteNumber(raw.duration, `${label}.duration`), 0, 24 * 60 * 60, `${label}.duration`);
  const currentTime = inRange(
    finiteNumber(raw.currentTime, `${label}.currentTime`),
    0,
    Math.max(duration, 0),
    `${label}.currentTime`,
  );
  if (typeof raw.isPlaying !== "boolean") throw new Error(`${label}.isPlaying must be a boolean`);
  if (raw.isPlaying && duration === 0) throw new Error(`${label} cannot be playing without a track`);

  return {
    isPlaying: raw.isPlaying,
    currentTime,
    duration,
    gain: inRange(finiteNumber(raw.gain, `${label}.gain`), 0, 1.5, `${label}.gain`),
    filterFreq: inRange(
      finiteNumber(raw.filterFreq, `${label}.filterFreq`),
      200,
      20_000,
      `${label}.filterFreq`,
    ),
    delayMix: inRange(finiteNumber(raw.delayMix, `${label}.delayMix`), 0, 1, `${label}.delayMix`),
    reverbMix: inRange(finiteNumber(raw.reverbMix, `${label}.reverbMix`), 0, 1, `${label}.reverbMix`),
  };
}

function validateSnapshot(raw: unknown): EngineSnapshot {
  if (!isRecord(raw)) throw new Error("initialState must be an object");
  return {
    A: validateDeckState(raw.A, "initialState.A"),
    B: validateDeckState(raw.B, "initialState.B"),
    crossfader: inRange(
      finiteNumber(raw.crossfader, "initialState.crossfader"),
      0,
      1,
      "initialState.crossfader",
    ),
  };
}

function validateTrackIdentity(raw: unknown, label: string): TrackIdentity {
  if (!isRecord(raw)) throw new Error(`${label} must be an object or null`);
  if (typeof raw.name !== "string" || raw.name.length === 0 || raw.name.length > 512) {
    throw new Error(`${label}.name must contain 1–512 characters`);
  }
  if (typeof raw.mimeType !== "string" || raw.mimeType.length > 128) {
    throw new Error(`${label}.mimeType is invalid`);
  }
  const size = finiteNumber(raw.size, `${label}.size`);
  if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024 * 1024) {
    throw new Error(`${label}.size is invalid`);
  }
  const durationSec = inRange(
    finiteNumber(raw.durationSec, `${label}.durationSec`),
    0,
    24 * 60 * 60,
    `${label}.durationSec`,
  );
  if (raw.sha256 !== undefined && (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sha256))) {
    throw new Error(`${label}.sha256 is invalid`);
  }
  return {
    name: raw.name,
    size,
    mimeType: raw.mimeType,
    durationSec,
    ...(typeof raw.sha256 === "string" ? { sha256: raw.sha256.toLowerCase() } : {}),
  };
}

function validateTrackReference(raw: unknown, label: string): TraceTrackReference {
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);
  if (raw.status === "unknown") {
    if (raw.identity !== null) throw new Error(`${label}.identity must be null when status is unknown`);
    return { status: "unknown", identity: null };
  }
  if (raw.status !== "known") throw new Error(`${label}.status is invalid`);
  return {
    status: "known",
    identity: raw.identity === null ? null : validateTrackIdentity(raw.identity, `${label}.identity`),
  };
}

function validateTracks(raw: unknown): TraceTracks {
  if (!isRecord(raw)) throw new Error("tracks must be an object");
  return {
    A: validateTrackReference(raw.A, "tracks.A"),
    B: validateTrackReference(raw.B, "tracks.B"),
  };
}

function validateEvent(raw: unknown, index: number): ControlEvent {
  const label = `events[${index}]`;
  if (!isRecord(raw)) throw new Error(`${label} must be an object`);

  const timestampMs = inRange(
    finiteNumber(raw.timestampMs, `${label}.timestampMs`),
    0,
    MAX_TRACE_DURATION_MS,
    `${label}.timestampMs`,
  );
  const deck = raw.deck;
  const control = raw.control;

  if (deck !== "A" && deck !== "B" && deck !== "master") {
    throw new Error(`${label}.deck is invalid`);
  }
  if (
    control !== "play" &&
    control !== "pause" &&
    control !== "seek" &&
    control !== "gain" &&
    control !== "filter" &&
    control !== "delay" &&
    control !== "reverb" &&
    control !== "crossfader"
  ) {
    throw new Error(`${label}.control is invalid`);
  }
  if ((deck === "master") !== (control === "crossfader")) {
    throw new Error(`${label} has an invalid deck/control combination`);
  }

  const typedControl = control as ControlName;
  if (deck !== "master" && !DECK_CONTROLS.has(typedControl)) {
    throw new Error(`${label} has an invalid deck/control combination`);
  }

  const numericValue = finiteNumber(raw.value, `${label}.value`);
  let value: number;
  switch (typedControl) {
    case "play":
      if (numericValue !== 1) throw new Error(`${label}.value must be 1 for play`);
      value = 1;
      break;
    case "pause":
      if (numericValue !== 0) throw new Error(`${label}.value must be 0 for pause`);
      value = 0;
      break;
    case "seek":
      value = inRange(numericValue, 0, 24 * 60 * 60, `${label}.value`);
      break;
    case "gain":
      value = inRange(numericValue, 0, 1.5, `${label}.value`);
      break;
    case "filter":
      value = inRange(numericValue, 200, 20_000, `${label}.value`);
      break;
    case "delay":
    case "reverb":
      value = inRange(numericValue, 0, 1, `${label}.value`);
      break;
    case "crossfader":
      value = inRange(numericValue, 0, 1, `${label}.value`);
      break;
  }

  const source = raw.source ?? "mouse";
  if (typeof source !== "string" || !USER_SOURCES.has(source as SourceId)) {
    throw new Error(`${label}.source is invalid`);
  }

  return {
    timestampMs: Math.round(timestampMs),
    deck,
    control: typedControl,
    value,
    source: source as Extract<SourceId, "mouse" | "keyboard">,
  };
}

function validateEvents(raw: unknown): ControlEvent[] {
  if (!Array.isArray(raw)) throw new Error("events must be an array");
  if (raw.length > MAX_TRACE_EVENTS) {
    throw new Error(`Trace exceeds the ${MAX_TRACE_EVENTS.toLocaleString()} event limit`);
  }

  return raw
    .map((event, index) => ({ event: validateEvent(event, index), index }))
    .sort((a, b) => a.event.timestampMs - b.event.timestampMs || a.index - b.index)
    .map(({ event }) => event);
}

function defaultSnapshot(): EngineSnapshot {
  const deck = (): DeckState => ({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    gain: 1,
    filterFreq: 20_000,
    delayMix: 0,
    reverbMix: 0,
  });
  return { A: deck(), B: deck(), crossfader: 0.5 };
}

function cloneSnapshot(snapshot: EngineSnapshot): EngineSnapshot {
  return { A: { ...snapshot.A }, B: { ...snapshot.B }, crossfader: snapshot.crossfader };
}

function cloneTracks(tracks: TraceTracks): TraceTracks {
  const clone = (track: TraceTrackReference): TraceTrackReference =>
    track.status === "unknown"
      ? { status: "unknown", identity: null }
      : { status: "known", identity: track.identity ? { ...track.identity } : null };
  return { A: clone(tracks.A), B: clone(tracks.B) };
}

function cloneSession(session: TraceSession): TraceSession {
  return {
    ...session,
    tracks: cloneTracks(session.tracks),
    initialState: cloneSnapshot(session.initialState),
    finalState: cloneSnapshot(session.finalState),
    events: session.events.map((event) => ({ ...event })),
  };
}

function serialiseEvent(event: ControlEvent): SerializedEvent {
  return {
    timestampMs: event.timestampMs,
    deck: event.deck,
    control: event.control,
    value: event.value,
    ...(event.source === "keyboard" ? { source: "keyboard" as const } : {}),
  };
}

export class TraceRecorder {
  private readonly bus: ControlBus;
  private session: TraceSession | null = null;
  private recording = false;
  private unsubscribe: (() => void) | null;

  constructor(bus: ControlBus) {
    this.bus = bus;
    this.unsubscribe = bus.subscribe((event) => {
      if (!this.recording || !this.session) return;
      if (event.source === "ghost" || event.source === "internal") return;
      if (this.session.events.length >= MAX_TRACE_EVENTS) return;
      if (event.timestampMs > MAX_TRACE_DURATION_MS) return;
      this.session.events.push({ ...event });
    });
  }

  get isRecording() {
    return this.recording;
  }

  start(initialState: EngineSnapshot, tracks: LoadedTracks) {
    this.session = {
      version: TRACE_VERSION,
      appVersion: APP_VERSION,
      recordedAt: new Date().toISOString(),
      durationMs: 0,
      tracks: knownTrackReferences(tracks),
      initialState: cloneSnapshot(initialState),
      finalState: cloneSnapshot(initialState),
      events: [],
    };
    this.recording = true;
  }

  stop(finalState?: EngineSnapshot): TraceSession | null {
    if (this.recording && this.session) {
      const lastEventMs = this.session.events.at(-1)?.timestampMs ?? 0;
      this.session.durationMs = Math.min(
        MAX_TRACE_DURATION_MS,
        Math.max(lastEventMs, Math.round(this.bus.elapsedMs())),
      );
      if (finalState) this.session.finalState = cloneSnapshot(finalState);
    }
    this.recording = false;
    return this.session ? cloneSession(this.session) : null;
  }

  peek(): TraceSession | null {
    if (!this.session) return null;
    const snapshot = cloneSession(this.session);
    if (this.recording) {
      snapshot.durationMs = Math.max(snapshot.durationMs, Math.round(this.bus.elapsedMs()));
    }
    return snapshot;
  }

  snapshot(): TraceSession | null {
    return this.peek();
  }

  load(session: TraceSession) {
    this.recording = false;
    this.session = cloneSession(session);
  }

  clear() {
    this.recording = false;
    this.session = null;
  }

  serialize(): string {
    if (!this.session) throw new Error("No trace is loaded");
    return TraceRecorder.export(this.session);
  }

  static export(session: TraceSession): string {
    const file: TraceFileV2 = {
      version: TRACE_VERSION,
      appVersion: session.appVersion,
      recordedAt: session.recordedAt,
      durationMs: session.durationMs,
      tracks: cloneTracks(session.tracks),
      initialState: cloneSnapshot(session.initialState),
      finalState: cloneSnapshot(session.finalState),
      events: session.events.map(serialiseEvent),
    };
    return JSON.stringify(file, null, 2);
  }

  static parseAndValidate(text: string): TraceSession {
    if (new TextEncoder().encode(text).byteLength > MAX_TRACE_FILE_BYTES) {
      throw new Error("Trace file exceeds the 5 MB limit");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("Trace is not valid JSON");
    }
    return TraceRecorder.import(raw);
  }

  /** Parse, validate, bound, and deterministically order a v1 or v2 trace. */
  static import(raw: unknown): TraceSession {
    if (!isRecord(raw)) throw new Error("Trace must be a JSON object");

    if (raw.version === 1) {
      const legacy = raw as unknown as TraceFileV1;
      const events = validateEvents(legacy.events);
      return {
        version: TRACE_VERSION,
        appVersion: "0.1.0",
        recordedAt: typeof legacy.recordedAt === "string" ? legacy.recordedAt : new Date().toISOString(),
        durationMs: events.at(-1)?.timestampMs ?? 0,
        tracks: unknownTrackReferences(),
        initialState: defaultSnapshot(),
        finalState: defaultSnapshot(),
        events,
      };
    }

    if (raw.version !== TRACE_VERSION) {
      throw new Error(`Unsupported trace version: ${String(raw.version)}`);
    }

    if (typeof raw.recordedAt !== "string" || !Number.isFinite(Date.parse(raw.recordedAt))) {
      throw new Error("recordedAt must be an ISO date string");
    }
    if (typeof raw.appVersion !== "string" || raw.appVersion.length === 0 || raw.appVersion.length > 64) {
      throw new Error("appVersion is invalid");
    }
    const events = validateEvents(raw.events);
    const durationMs = inRange(
      finiteNumber(raw.durationMs, "durationMs"),
      0,
      MAX_TRACE_DURATION_MS,
      "durationMs",
    );
    const lastEventMs = events.at(-1)?.timestampMs ?? 0;
    if (durationMs < lastEventMs) {
      throw new Error("durationMs cannot be earlier than the final event");
    }

    const initialState = validateSnapshot(raw.initialState);
    const finalState = validateSnapshot(raw.finalState);
    const tracks = validateTracks(raw.tracks);
    for (const deck of ["A", "B"] as const) {
      const reference = tracks[deck];
      if (reference.status !== "known") continue;
      if (reference.identity === null && (initialState[deck].duration > 0 || finalState[deck].duration > 0)) {
        throw new Error(`tracks.${deck} is missing identity metadata for a loaded snapshot`);
      }
      if (
        reference.identity &&
        (Math.abs(reference.identity.durationSec - initialState[deck].duration) > 0.25 ||
          Math.abs(reference.identity.durationSec - finalState[deck].duration) > 0.25)
      ) {
        throw new Error(`tracks.${deck} duration does not match the snapshots`);
      }
    }

    return {
      version: TRACE_VERSION,
      appVersion: raw.appVersion,
      recordedAt: raw.recordedAt,
      durationMs: Math.round(durationMs),
      tracks,
      initialState,
      finalState,
      events,
    };
  }

  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
