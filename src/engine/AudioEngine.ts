/**
 * AudioEngine
 * Manages all Web Audio API nodes for both decks plus the master crossfader.
 * Graph per deck:
 *   BufferSourceNode -> GainNode (deck gain) -> BiquadFilterNode (low-pass) -> GainNode (xfade side) -> destination
 * Analyser is tapped after the xfade gains and merged for the visualiser.
 */

export type DeckId = "A" | "B";

export interface DeckState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  gain: number;
  filterFreq: number;
}

export interface EngineSnapshot {
  A: DeckState;
  B: DeckState;
  crossfader: number; // 0..1
}

interface DeckNodes {
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  xfadeGain: GainNode;
  analyser: AnalyserNode;
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  startedAt: number; // audioContext.currentTime when source was started
  pausedAt: number;  // buffer offset when paused
  isPlaying: boolean;
  gain: number;
  filterFreq: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private decks: Record<DeckId, DeckNodes>;
  crossfaderValue = 0.5; // 0 = full A, 1 = full B

  constructor() {
    this.ctx = new AudioContext();
    this.decks = {
      A: this._createDeck(),
      B: this._createDeck(),
    };
    this._updateXfade(0.5);
  }

  private _createDeck(): DeckNodes {
    const { ctx } = this;
    const gainNode = ctx.createGain();
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = "lowpass";
    filterNode.frequency.value = 20000;
    const xfadeGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    gainNode.connect(filterNode);
    filterNode.connect(xfadeGain);
    xfadeGain.connect(analyser);
    analyser.connect(ctx.destination);

    return {
      gainNode,
      filterNode,
      xfadeGain,
      analyser,
      source: null,
      buffer: null,
      startedAt: 0,
      pausedAt: 0,
      isPlaying: false,
      gain: 1,
      filterFreq: 20000,
    };
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Load an ArrayBuffer into a deck, decoding it as PCM. */
  async loadBuffer(deck: DeckId, arrayBuffer: ArrayBuffer): Promise<void> {
    await this.resume();
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    const d = this.decks[deck];
    if (d.isPlaying) this._stopSource(deck);
    d.buffer = buffer;
    d.pausedAt = 0;
  }

  play(deck: DeckId) {
    const d = this.decks[deck];
    if (!d.buffer || d.isPlaying) return;
    this._startSource(deck, d.pausedAt);
  }

  pause(deck: DeckId) {
    const d = this.decks[deck];
    if (!d.isPlaying) return;
    const elapsed = this.ctx.currentTime - d.startedAt;
    d.pausedAt = Math.min(elapsed, d.buffer?.duration ?? 0);
    this._stopSource(deck);
  }

  seek(deck: DeckId, positionSec: number) {
    const d = this.decks[deck];
    if (!d.buffer) return;
    const wasPlaying = d.isPlaying;
    if (wasPlaying) this._stopSource(deck);
    d.pausedAt = Math.max(0, Math.min(positionSec, d.buffer.duration));
    if (wasPlaying) this._startSource(deck, d.pausedAt);
  }

  setGain(deck: DeckId, value: number) {
    const d = this.decks[deck];
    d.gain = value;
    d.gainNode.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }

  setFilter(deck: DeckId, freqHz: number) {
    const d = this.decks[deck];
    d.filterFreq = freqHz;
    d.filterNode.frequency.setTargetAtTime(freqHz, this.ctx.currentTime, 0.01);
  }

  setCrossfader(value: number) {
    this.crossfaderValue = Math.max(0, Math.min(1, value));
    this._updateXfade(this.crossfaderValue);
  }

  private _updateXfade(v: number) {
    // Equal-power crossfade
    const angle = (v * Math.PI) / 2;
    const gainA = Math.cos(angle);
    const gainB = Math.sin(angle);
    const now = this.ctx.currentTime;
    this.decks.A.xfadeGain.gain.setTargetAtTime(gainA, now, 0.01);
    this.decks.B.xfadeGain.gain.setTargetAtTime(gainB, now, 0.01);
  }

  private _startSource(deck: DeckId, offset: number) {
    const d = this.decks[deck];
    if (!d.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = d.buffer;
    src.connect(d.gainNode);
    src.start(0, offset);
    src.onended = () => {
      if (d.source === src) {
        d.isPlaying = false;
        d.source = null;
        d.pausedAt = 0;
      }
    };
    d.source = src;
    d.startedAt = this.ctx.currentTime - offset;
    d.isPlaying = true;
  }

  private _stopSource(deck: DeckId) {
    const d = this.decks[deck];
    if (!d.source) return;
    try { d.source.stop(); } catch { /* already stopped */ }
    d.source.disconnect();
    d.source = null;
    d.isPlaying = false;
  }

  getAnalyser(deck: DeckId): AnalyserNode {
    return this.decks[deck].analyser;
  }

  getDeckState(deck: DeckId): DeckState {
    const d = this.decks[deck];
    const currentTime = d.isPlaying
      ? this.ctx.currentTime - d.startedAt
      : d.pausedAt;
    return {
      isPlaying: d.isPlaying,
      currentTime: Math.max(0, currentTime),
      duration: d.buffer?.duration ?? 0,
      gain: d.gain,
      filterFreq: d.filterFreq,
    };
  }

  hasBuffer(deck: DeckId): boolean {
    return this.decks[deck].buffer !== null;
  }

  resetDeck(deck: DeckId) {
    this._stopSource(deck);
    const d = this.decks[deck];
    d.pausedAt = 0;
    d.gain = 1;
    d.gainNode.gain.value = 1;
    d.filterFreq = 20000;
    d.filterNode.frequency.value = 20000;
  }

  resetAll() {
    this.resetDeck("A");
    this.resetDeck("B");
    this.setCrossfader(0.5);
  }
}
