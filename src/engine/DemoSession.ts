import type { AudioEngine, DeckState, EngineSnapshot } from "./AudioEngine";
import type { ControlEvent, DeckId } from "./ControlBus";
import { knownTrackReferences, sha256Hex, type LoadedTracks, type TrackIdentity } from "./TrackIdentity";
import { TRACE_VERSION, type TraceSession } from "./TraceRecorder";
import { APP_VERSION } from "../version";

export const DEMO_BPM = 120;
export const DEMO_DURATION_SEC = 16;
export const DEMO_REPLAY_DURATION_MS = 12_000;
const SAMPLE_RATE = 44_100;
const TAU = Math.PI * 2;
const BEAT_SEC = 60 / DEMO_BPM;

// Two bars each of Am7, Fmaj7, Cmaj7, and G6. Both original parts share
// this progression and a fixed seed, so their WAV fingerprints are repeatable.
const ROOTS = [55, 43.653528929125486, 65.40639132514966, 48.99942949771866];
const CHORDS = [
  [220, 261.6255653005986, 329.6275569128699, 391.99543598174927],
  [174.61411571650194, 220, 261.6255653005986, 329.6275569128699],
  [261.6255653005986, 329.6275569128699, 391.99543598174927, 493.8833012561241],
  [195.99771799087463, 246.94165062806206, 293.6647679174076, 329.6275569128699],
];

function writeText(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** Create an original, quiet, eight-bar mono PCM WAV entirely in the browser. */
export function generateDemoWav(deck: DeckId): ArrayBuffer {
  const sampleCount = SAMPLE_RATE * DEMO_DURATION_SEC;
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let seed = deck === "A" ? 0x47484f53 : 0x4445434b;
  let previousNoise = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const noise = seed / 0x1_0000_0000 * 2 - 1;
    const time = index / SAMPLE_RATE;
    const beat = Math.floor(time / BEAT_SEC);
    const beatAge = time - beat * BEAT_SEC;
    const bar = Math.floor(beat / 4);
    const harmony = Math.floor(bar / 2) % CHORDS.length;
    let sample = 0;

    if (deck === "A") {
      // A short pitch sweep supplies the kick without a sharp sample edge.
      const kickPhase = TAU * (48 * beatAge + 95 * (1 - Math.exp(-beatAge * 35)) / 35);
      const kick = Math.sin(kickPhase) * Math.exp(-beatAge * 16) * 0.34;
      const clap = beat % 2 === 1
        ? noise * Math.exp(-beatAge * 30) * Math.min(1, beatAge / 0.002) * 0.065
        : 0;
      const eighth = Math.floor(time / (BEAT_SEC / 2));
      const noteAge = time - eighth * BEAT_SEC / 2;
      const bassFrequency = ROOTS[harmony] * (eighth % 8 === 6 ? 2 : 1);
      const bassPhase = TAU * bassFrequency * noteAge;
      const bassEnvelope = Math.min(1, noteAge / 0.008) * Math.exp(-noteAge * 9)
        * Math.min(1, ((BEAT_SEC / 2) - noteAge) / 0.012);
      const bass = (Math.sin(bassPhase) + 0.22 * Math.sin(bassPhase * 2)) * bassEnvelope * 0.13;
      sample = kick + clap + bass;
    } else {
      const eighth = Math.floor(time / (BEAT_SEC / 2));
      const hatAge = time - eighth * BEAT_SEC / 2;
      const hatEnvelope = Math.min(1, hatAge / 0.0015)
        * Math.exp(-hatAge * (eighth % 2 === 0 ? 75 : 35));
      const hat = (noise - previousNoise) * hatEnvelope * 0.045;
      const chordAge = time - bar * BEAT_SEC * 4;
      const chordEnvelope = Math.min(1, chordAge / 0.025) * Math.exp(-chordAge * 1.7)
        * Math.min(1, (BEAT_SEC * 4 - chordAge) / 0.04);
      const chord = CHORDS[harmony].reduce((sum, frequency) => {
        const phase = TAU * frequency * chordAge;
        return sum + Math.sin(phase) + 0.12 * Math.sin(phase * 2);
      }, 0) * chordEnvelope * 0.043;
      sample = hat + chord;
    }

    previousNoise = noise;
    const edgeFade = Math.min(1, time / 0.008, (sampleCount - 1 - index) / (SAMPLE_RATE * 0.016));
    // Leave ample headroom when equal-power mixing adds the two parts.
    const safeSample = Math.max(-0.6, Math.min(0.6, sample * edgeFade));
    view.setInt16(44 + index * 2, Math.round(safeSample * 0x7fff), true);
  }
  return buffer;
}

function createDemoTrace(tracks: LoadedTracks): TraceSession {
  const initialDeck = (filterFreq: number): DeckState => ({
    isPlaying: true,
    currentTime: 0,
    duration: DEMO_DURATION_SEC,
    gain: 0.85,
    filterFreq,
    delayMix: 0,
    reverbMix: 0,
  });
  const initialState: EngineSnapshot = {
    A: initialDeck(20_000),
    B: initialDeck(8_000),
    crossfader: 0,
  };
  const events: ControlEvent[] = [];
  for (let step = 0; step <= 64; step += 1) {
    const progress = step / 64;
    const eased = progress * progress * (3 - 2 * progress);
    const timestampMs = 2_000 + step * 125;
    events.push({ timestampMs, deck: "master", control: "crossfader", value: eased, source: "mouse" });
    if (step % 4 === 0) {
      events.push(
        { timestampMs, deck: "A", control: "filter", value: 20_000 - eased * 16_000, source: "mouse" },
        { timestampMs, deck: "B", control: "filter", value: 8_000 + eased * 12_000, source: "mouse" },
        { timestampMs, deck: "A", control: "delay", value: 0.16 * 4 * progress * (1 - progress), source: "mouse" },
      );
    }
  }

  return {
    version: TRACE_VERSION,
    appVersion: APP_VERSION,
    recordedAt: "2026-09-05T00:00:00.000Z",
    durationMs: DEMO_REPLAY_DURATION_MS,
    tracks: knownTrackReferences(tracks),
    initialState,
    finalState: {
      A: { ...initialState.A, currentTime: DEMO_REPLAY_DURATION_MS / 1_000, filterFreq: 4_000 },
      B: { ...initialState.B, currentTime: DEMO_REPLAY_DURATION_MS / 1_000, filterFreq: 20_000 },
      crossfader: 1,
    },
    events,
  };
}

/**
 * Call from a user gesture after ending any active recording/replay. Loading
 * resumes the AudioContext, but does not play audio or apply the trace snapshot.
 * The caller owns the stopped preview state and explicitly starts replay.
 * Each successful replacement is reported immediately, so the caller can keep
 * identities accurate even if loading the next deck fails.
 */
export async function loadDemoSession(
  engine: AudioEngine,
  onTrackLoaded?: (deck: DeckId, track: TrackIdentity) => void,
): Promise<{ trace: TraceSession; tracks: LoadedTracks }> {
  const tracks: LoadedTracks = { A: null, B: null };
  for (const deck of ["A", "B"] as const) {
    const buffer = generateDemoWav(deck);
    // decodeAudioData can detach its input; fingerprint and measure it first.
    const identity: TrackIdentity = {
      name: deck === "A" ? "Night Drive — drums & bass.wav" : "Afterglow — hats & chords.wav",
      size: buffer.byteLength,
      mimeType: "audio/wav",
      durationSec: DEMO_DURATION_SEC,
      sha256: await sha256Hex(buffer),
    };
    await engine.loadBuffer(deck, buffer);
    tracks[deck] = identity;
    onTrackLoaded?.(deck, identity);
  }
  return { trace: createDemoTrace(tracks), tracks };
}
