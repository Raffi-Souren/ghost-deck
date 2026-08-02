/**
 * Web Audio graph and the defensive boundary for every deck control.
 *
 * Per deck:
 *   source -> gain -> low-pass -> pre-fader analyser -> xfade gain
 * Both decks:
 *   -> master gain -> safety limiter -> master analyser -> destination
 */

import type { ControlBus, ControlEvent, DeckId } from "./ControlBus";
import {
  clamp,
  equalPowerGains,
  MAX_DECK_GAIN,
  MAX_FILTER_HZ,
  MIN_FILTER_HZ,
} from "./AudioMath";
import { computeWaveformPeaks } from "./Waveform";

export type { DeckId } from "./ControlBus";

export interface DeckState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  gain: number;
  filterFreq: number;
  delayMix: number;
  reverbMix: number;
}

export interface EngineSnapshot {
  A: DeckState;
  B: DeckState;
  crossfader: number;
}

interface DeckNodes {
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  xfadeGain: GainNode;
  analyser: AnalyserNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  reverbNode: ConvolverNode;
  reverbWet: GainNode;
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  startedAt: number;
  pausedAt: number;
  isPlaying: boolean;
  gain: number;
  filterFreq: number;
  delayMix: number;
  reverbMix: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly masterAnalyser: AnalyserNode;
  private readonly reverbImpulse: AudioBuffer;
  private readonly decks: Record<DeckId, DeckNodes>;
  private unsubscribe: (() => void) | null;
  crossfaderValue = 0.5;

  constructor(bus: ControlBus) {
    this.ctx = new AudioContext();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.1;

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 256;
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    this.reverbImpulse = this.createReverbImpulse();

    this.decks = { A: this.createDeck(), B: this.createDeck() };
    this.updateCrossfader(0.5, true);
    this.unsubscribe = bus.subscribe((event) => this.handleEvent(event));
  }

  private createDeck(): DeckNodes {
    const gainNode = this.ctx.createGain();
    const filterNode = this.ctx.createBiquadFilter();
    const analyser = this.ctx.createAnalyser();
    const xfadeGain = this.ctx.createGain();

    filterNode.type = "lowpass";
    filterNode.frequency.value = MAX_FILTER_HZ;
    analyser.fftSize = 256;

    gainNode.connect(filterNode);
    filterNode.connect(analyser);
    const effects = this.connectEffects(analyser, xfadeGain);
    xfadeGain.connect(this.masterGain);

    return {
      gainNode,
      filterNode,
      analyser,
      xfadeGain,
      ...effects,
      source: null,
      buffer: null,
      startedAt: 0,
      pausedAt: 0,
      isPlaying: false,
      gain: 1,
      filterFreq: MAX_FILTER_HZ,
      delayMix: 0,
      reverbMix: 0,
    };
  }

  private createReverbImpulse(): AudioBuffer {
    const durationSec = 1.6;
    const length = Math.ceil(this.ctx.sampleRate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    let seed = 0x47484f53;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const envelope = Math.pow(1 - index / length, 2.8);
        data[index] = (random() * 2 - 1) * envelope;
      }
    }
    return impulse;
  }

  private connectEffects(analyser: AnalyserNode, xfadeGain: GainNode) {
    const delayNode = this.ctx.createDelay(1);
    const delayFeedback = this.ctx.createGain();
    const delayWet = this.ctx.createGain();
    const reverbNode = this.ctx.createConvolver();
    const reverbWet = this.ctx.createGain();

    delayNode.delayTime.value = 0.375;
    delayFeedback.gain.value = 0.32;
    delayWet.gain.value = 0;
    reverbNode.buffer = this.reverbImpulse;
    reverbWet.gain.value = 0;

    analyser.connect(xfadeGain);
    analyser.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(xfadeGain);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    analyser.connect(reverbNode);
    reverbNode.connect(reverbWet);
    reverbWet.connect(xfadeGain);

    return { delayNode, delayFeedback, delayWet, reverbNode, reverbWet };
  }

  private rebuildEffects(deck: DeckId) {
    const state = this.decks[deck];
    state.analyser.disconnect();
    state.delayNode.disconnect();
    state.delayFeedback.disconnect();
    state.delayWet.disconnect();
    state.reverbNode.disconnect();
    state.reverbWet.disconnect();
    Object.assign(state, this.connectEffects(state.analyser, state.xfadeGain));
  }

  private handleEvent(event: ControlEvent) {
    if (event.control === "crossfader") {
      if (event.deck === "master") this.setCrossfader(event.value);
      return;
    }
    if (event.deck !== "A" && event.deck !== "B") return;

    switch (event.control) {
      case "play":
        this.play(event.deck);
        break;
      case "pause":
        this.pause(event.deck);
        break;
      case "seek":
        this.seek(event.deck, event.value);
        break;
      case "gain":
        this.setGain(event.deck, event.value);
        break;
      case "filter":
        this.setFilter(event.deck, event.value);
        break;
      case "delay":
        this.setDelay(event.deck, event.value);
        break;
      case "reverb":
        this.setReverb(event.deck, event.value);
        break;
    }
  }

  async resume() {
    if (this.ctx.state === "closed") throw new Error("Audio engine is closed");
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  async loadBuffer(deck: DeckId, arrayBuffer: ArrayBuffer): Promise<void> {
    await this.resume();
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    const state = this.decks[deck];
    this.stopSource(deck);
    this.rebuildEffects(deck);
    this.setDelay(deck, state.delayMix, true);
    this.setReverb(deck, state.reverbMix, true);
    state.buffer = buffer;
    state.pausedAt = 0;
  }

  play(deck: DeckId) {
    const state = this.decks[deck];
    if (!state.buffer || state.isPlaying) return;
    if (state.pausedAt >= state.buffer.duration) state.pausedAt = 0;
    this.startSource(deck, state.pausedAt);
  }

  pause(deck: DeckId) {
    const state = this.decks[deck];
    if (!state.isPlaying) return;
    const elapsed = this.ctx.currentTime - state.startedAt;
    state.pausedAt = clamp(elapsed, 0, state.buffer?.duration ?? 0);
    this.stopSource(deck);
  }

  stopAll() {
    this.pause("A");
    this.pause("B");
    for (const deck of ["A", "B"] as const) {
      const state = this.decks[deck];
      this.rebuildEffects(deck);
      this.setDelay(deck, state.delayMix, true);
      this.setReverb(deck, state.reverbMix, true);
    }
  }

  seek(deck: DeckId, positionSec: number) {
    const state = this.decks[deck];
    if (!state.buffer || !Number.isFinite(positionSec)) return;
    const wasPlaying = state.isPlaying;
    if (wasPlaying) this.stopSource(deck);
    state.pausedAt = clamp(positionSec, 0, state.buffer.duration);
    if (wasPlaying) this.startSource(deck, state.pausedAt);
  }

  setGain(deck: DeckId, value: number, immediate = false) {
    if (!Number.isFinite(value)) return;
    const state = this.decks[deck];
    state.gain = clamp(value, 0, MAX_DECK_GAIN);
    this.setAudioParam(state.gainNode.gain, state.gain, immediate);
  }

  setFilter(deck: DeckId, freqHz: number, immediate = false) {
    if (!Number.isFinite(freqHz)) return;
    const state = this.decks[deck];
    state.filterFreq = clamp(freqHz, MIN_FILTER_HZ, MAX_FILTER_HZ);
    this.setAudioParam(state.filterNode.frequency, state.filterFreq, immediate);
  }

  setDelay(deck: DeckId, value: number, immediate = false) {
    if (!Number.isFinite(value)) return;
    const state = this.decks[deck];
    state.delayMix = clamp(value, 0, 1);
    this.setAudioParam(state.delayWet.gain, state.delayMix * 0.7, immediate);
  }

  setReverb(deck: DeckId, value: number, immediate = false) {
    if (!Number.isFinite(value)) return;
    const state = this.decks[deck];
    state.reverbMix = clamp(value, 0, 1);
    this.setAudioParam(state.reverbWet.gain, state.reverbMix * 0.65, immediate);
  }

  setCrossfader(value: number, immediate = false) {
    if (!Number.isFinite(value)) return;
    this.crossfaderValue = clamp(value, 0, 1);
    this.updateCrossfader(this.crossfaderValue, immediate);
  }

  private setAudioParam(param: AudioParam, value: number, immediate: boolean) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    if (immediate) param.setValueAtTime(value, now);
    else param.setTargetAtTime(value, now, 0.01);
  }

  private updateCrossfader(value: number, immediate: boolean) {
    const gains = equalPowerGains(value);
    this.setAudioParam(this.decks.A.xfadeGain.gain, gains.A, immediate);
    this.setAudioParam(this.decks.B.xfadeGain.gain, gains.B, immediate);
  }

  private startSource(deck: DeckId, requestedOffset: number) {
    const state = this.decks[deck];
    if (!state.buffer || state.buffer.duration <= 0) return;

    const endSafeOffset = Math.max(0, state.buffer.duration - 0.001);
    const offset = clamp(requestedOffset, 0, endSafeOffset);
    const source = this.ctx.createBufferSource();
    source.buffer = state.buffer;
    source.connect(state.gainNode);
    source.start(0, offset);
    source.onended = () => {
      if (state.source !== source) return;
      state.isPlaying = false;
      state.source = null;
      state.pausedAt = 0;
    };

    state.source = source;
    state.startedAt = this.ctx.currentTime - offset;
    state.pausedAt = offset;
    state.isPlaying = true;
  }

  private stopSource(deck: DeckId) {
    const state = this.decks[deck];
    if (!state.source) {
      state.isPlaying = false;
      return;
    }
    state.source.onended = null;
    try {
      state.source.stop();
    } catch {
      // Source may already have ended between the state read and stop().
    }
    state.source.disconnect();
    state.source = null;
    state.isPlaying = false;
  }

  getAnalyser(deck: DeckId): AnalyserNode {
    return this.decks[deck].analyser;
  }

  getMasterAnalyser(): AnalyserNode {
    return this.masterAnalyser;
  }

  getWaveformPeaks(deck: DeckId, bucketCount = 320): number[] {
    const buffer = this.decks[deck].buffer;
    if (!buffer) return [];
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, channel) => buffer.getChannelData(channel),
    );
    return computeWaveformPeaks(channels, bucketCount);
  }

  getDeckState(deck: DeckId): DeckState {
    const state = this.decks[deck];
    const duration = state.buffer?.duration ?? 0;
    const currentTime = state.isPlaying
      ? this.ctx.currentTime - state.startedAt
      : state.pausedAt;
    return {
      isPlaying: state.isPlaying,
      currentTime: clamp(currentTime, 0, duration),
      duration,
      gain: state.gain,
      filterFreq: state.filterFreq,
      delayMix: state.delayMix,
      reverbMix: state.reverbMix,
    };
  }

  getSnapshot(): EngineSnapshot {
    return {
      A: this.getDeckState("A"),
      B: this.getDeckState("B"),
      crossfader: this.crossfaderValue,
    };
  }

  hasBuffer(deck: DeckId): boolean {
    return this.decks[deck].buffer !== null;
  }

  resetDeck(deck: DeckId) {
    this.stopSource(deck);
    const state = this.decks[deck];
    this.rebuildEffects(deck);
    state.pausedAt = 0;
    this.setGain(deck, 1, true);
    this.setFilter(deck, MAX_FILTER_HZ, true);
    this.setDelay(deck, 0, true);
    this.setReverb(deck, 0, true);
  }

  resetAll() {
    this.resetDeck("A");
    this.resetDeck("B");
    this.setCrossfader(0.5, true);
  }

  /** Restore mixer values, cue positions, then start decks captured as playing. */
  applySnapshot(snapshot: EngineSnapshot) {
    this.resetDeck("A");
    this.resetDeck("B");

    for (const deck of ["A", "B"] as const) {
      this.setGain(deck, snapshot[deck].gain, true);
      this.setFilter(deck, snapshot[deck].filterFreq, true);
      this.setDelay(deck, snapshot[deck].delayMix, true);
      this.setReverb(deck, snapshot[deck].reverbMix, true);
      this.seek(deck, snapshot[deck].currentTime);
    }
    this.setCrossfader(snapshot.crossfader, true);

    if (snapshot.A.isPlaying) this.play("A");
    if (snapshot.B.isPlaying) this.play("B");
  }

  async destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.stopSource("A");
    this.stopSource("B");
    for (const deck of ["A", "B"] as const) {
      this.decks[deck].gainNode.disconnect();
      this.decks[deck].filterNode.disconnect();
      this.decks[deck].analyser.disconnect();
      this.decks[deck].xfadeGain.disconnect();
      this.decks[deck].delayNode.disconnect();
      this.decks[deck].delayFeedback.disconnect();
      this.decks[deck].delayWet.disconnect();
      this.decks[deck].reverbNode.disconnect();
      this.decks[deck].reverbWet.disconnect();
    }
    this.masterGain.disconnect();
    this.limiter.disconnect();
    this.masterAnalyser.disconnect();
    if (this.ctx.state !== "closed") await this.ctx.close();
  }
}
