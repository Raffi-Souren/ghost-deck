import { useRef, useState, useCallback } from "react";
import type { AudioEngine } from "../engine/AudioEngine";
import type { ControlBus, DeckId } from "../engine/ControlBus";
import { filterHzToUnit, filterUnitToHz } from "../engine/AudioMath";
import { sha256Hex, type TrackIdentity } from "../engine/TrackIdentity";
import { useDeckState } from "../hooks/useDeckState";
import { Visualiser } from "./Visualiser";
import { WaveformOverview } from "./WaveformOverview";

interface Props {
  id: DeckId;
  engine: AudioEngine;
  bus: ControlBus;
  ghostGain?: number;
  ghostFilter?: number;
  ghostDelay?: number;
  ghostReverb?: number;
  loadDisabled: boolean;
  controlsDisabled: boolean;
  onTrackLoaded: (deck: DeckId, track: TrackIdentity) => void;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function Deck({
  id,
  engine,
  bus,
  ghostGain,
  ghostFilter,
  ghostDelay,
  ghostReverb,
  loadDisabled,
  controlsDisabled,
  onTrackLoaded,
}: Props) {
  const state = useDeckState(engine, id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([]);

  const loadFile = useCallback(async (file: File) => {
    if (loadDisabled) return;
    setError("");
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(file.name)) {
      setError("UNSUPPORTED OR UNRECOGNIZED AUDIO");
      return;
    }

    setIsLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const fingerprintBuffer = arrayBuffer.slice(0);
      const fingerprint = sha256Hex(fingerprintBuffer).catch(() => undefined);
      await engine.loadBuffer(id, arrayBuffer);
      const durationSec = engine.getDeckState(id).duration;
      setWaveformPeaks(engine.getWaveformPeaks(id));
      const sha256 = await fingerprint;
      const identity: TrackIdentity = {
        name: file.name,
        size: file.size,
        mimeType: file.type,
        durationSec,
        ...(sha256 ? { sha256 } : {}),
      };
      setFileName(file.name);
      onTrackLoaded(id, identity);
    } catch (loadError) {
      setError("DECODE FAILED IN THIS BROWSER");
      console.error(loadError);
    } finally {
      setIsLoading(false);
    }
  }, [engine, id, loadDisabled, onTrackLoaded]);

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  const handlePlayPause = () => {
    void engine.resume();
    bus.dispatch(id, state.isPlaying ? "pause" : "play", state.isPlaying ? 0 : 1);
  };

  const hasTrack = engine.hasBuffer(id);
  const progress = state.duration > 0 ? state.currentTime / state.duration : 0;
  const deckLabelId = `deck-${id.toLowerCase()}-label`;
  const seekId = `deck-${id.toLowerCase()}-seek`;
  const gainId = `deck-${id.toLowerCase()}-gain`;
  const filterId = `deck-${id.toLowerCase()}-filter`;
  const delayId = `deck-${id.toLowerCase()}-delay`;
  const reverbId = `deck-${id.toLowerCase()}-reverb`;

  return (
    <section
      className={`deck deck-${id.toLowerCase()} ${isDragOver ? "deck--dragover" : ""} ${controlsDisabled ? "deck--locked" : ""}`}
      aria-labelledby={deckLabelId}
      aria-busy={isLoading}
      onDragOver={(event) => {
        if (loadDisabled) return;
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="deck-header">
        <h2 className="deck-label" id={deckLabelId}>DECK {id}</h2>
        {hasTrack && <span className="deck-loaded">● LOADED</span>}
        {controlsDisabled && <span className="deck-lock">GHOST LOCK</span>}
      </div>

      <div className="deck-loader">
        <button
          type="button"
          className="btn btn-file"
          onClick={() => inputRef.current?.click()}
          disabled={loadDisabled || isLoading}
        >
          {isLoading ? "HASHING + DECODING…" : "LOAD TRACK"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a"
          onChange={handleFileInput}
          hidden
          disabled={loadDisabled}
        />
        <span className="deck-filename" title={fileName || undefined}>
          {error ? <span className="error" role="alert">{error}</span> : (fileName || "DROP LOCAL AUDIO HERE")}
        </span>
      </div>

      <div className="visualiser-label">LIVE SPECTRUM // PRE-FADER</div>
      <div className="visualiser-wrap" aria-hidden="true">
        <Visualiser analyser={engine.getAnalyser(id)} color={id === "A" ? "#00ff99" : "#ff7a29"} />
      </div>

      <WaveformOverview
        peaks={waveformPeaks}
        progress={progress}
        duration={state.duration}
        color={id === "A" ? "#00ff99" : "#ff7a29"}
        disabled={controlsDisabled}
        deckLabel={`Deck ${id}`}
        onSeek={(seconds) => bus.dispatch(id, "seek", seconds)}
      />

      <div className="progress-row">
        <span className="timecode">{formatTime(state.currentTime)}</span>
        <label className="sr-only" htmlFor={seekId}>Deck {id} position</label>
        <input
          id={seekId}
          type="range"
          className="seek-bar"
          min={0}
          max={state.duration || 1}
          step={0.01}
          value={state.currentTime}
          onChange={(event) => bus.dispatch(id, "seek", Number(event.target.value))}
          disabled={!hasTrack || controlsDisabled}
          aria-valuetext={`${formatTime(state.currentTime)} of ${formatTime(state.duration)}`}
        />
        <span className="timecode">{formatTime(state.duration)}</span>
      </div>

      <button
        type="button"
        className={`btn btn-play ${state.isPlaying ? "btn-play--active" : ""}`}
        onClick={handlePlayPause}
        disabled={!hasTrack || controlsDisabled}
      >
        {state.isPlaying ? "⏸ PAUSE" : "▶ PLAY"}
      </button>

      <div className="knob-row">
        <label className="knob-label" htmlFor={gainId}>GAIN</label>
        <div className="knob-track-wrap">
          <input
            id={gainId}
            type="range"
            className="knob-range"
            min={0}
            max={1.5}
            step={0.01}
            value={state.gain}
            onChange={(event) => bus.dispatch(id, "gain", Number(event.target.value))}
            disabled={controlsDisabled}
            aria-valuetext={state.gain.toFixed(2)}
          />
          {ghostGain !== undefined && (
            <div className="ghost-marker" style={{ left: `${(ghostGain / 1.5) * 100}%` }} aria-hidden="true" />
          )}
        </div>
        <span className="knob-value">{state.gain.toFixed(2)}</span>
      </div>

      <div className="knob-row">
        <label className="knob-label" htmlFor={filterId}>LPF</label>
        <div className="knob-track-wrap">
          <input
            id={filterId}
            type="range"
            className="knob-range"
            min={0}
            max={1}
            step={0.001}
            value={filterHzToUnit(state.filterFreq)}
            onChange={(event) => bus.dispatch(id, "filter", filterUnitToHz(Number(event.target.value)))}
            disabled={controlsDisabled}
            aria-valuetext={`${Math.round(state.filterFreq)} hertz`}
          />
          {ghostFilter !== undefined && (
            <div className="ghost-marker" style={{ left: `${filterHzToUnit(ghostFilter) * 100}%` }} aria-hidden="true" />
          )}
        </div>
        <span className="knob-value">{Math.round(state.filterFreq)}Hz</span>
      </div>

      <div className="knob-row">
        <label className="knob-label" htmlFor={delayId}>DELAY</label>
        <div className="knob-track-wrap">
          <input
            id={delayId}
            type="range"
            className="knob-range"
            min={0}
            max={1}
            step={0.01}
            value={state.delayMix}
            onChange={(event) => bus.dispatch(id, "delay", Number(event.target.value))}
            disabled={controlsDisabled}
            aria-valuetext={`${Math.round(state.delayMix * 100)} percent, 375 millisecond echo`}
          />
          {ghostDelay !== undefined && (
            <div className="ghost-marker" style={{ left: `${ghostDelay * 100}%` }} aria-hidden="true" />
          )}
        </div>
        <span className="knob-value">{Math.round(state.delayMix * 100)}%</span>
      </div>

      <div className="knob-row">
        <label className="knob-label" htmlFor={reverbId}>SPACE</label>
        <div className="knob-track-wrap">
          <input
            id={reverbId}
            type="range"
            className="knob-range"
            min={0}
            max={1}
            step={0.01}
            value={state.reverbMix}
            onChange={(event) => bus.dispatch(id, "reverb", Number(event.target.value))}
            disabled={controlsDisabled}
            aria-valuetext={`${Math.round(state.reverbMix * 100)} percent reverb`}
          />
          {ghostReverb !== undefined && (
            <div className="ghost-marker" style={{ left: `${ghostReverb * 100}%` }} aria-hidden="true" />
          )}
        </div>
        <span className="knob-value">{Math.round(state.reverbMix * 100)}%</span>
      </div>

      <div className="deck-quick-actions">
        <button
          type="button"
          className="btn btn-reset"
          onClick={() => bus.dispatch(id, "filter", 20_000)}
          disabled={controlsDisabled || state.filterFreq >= 19_999}
        >
          CLEAR LPF
        </button>
        <button
          type="button"
          className="btn btn-reset"
          onClick={() => {
            bus.dispatch(id, "delay", 0);
            bus.dispatch(id, "reverb", 0);
          }}
          disabled={controlsDisabled || (state.delayMix === 0 && state.reverbMix === 0)}
        >
          CLEAR FX
        </button>
      </div>

      <div className="progress-px" aria-hidden="true">
        <div className="progress-px-fill" style={{ width: `${progress * 100}%` }} />
      </div>
    </section>
  );
}
