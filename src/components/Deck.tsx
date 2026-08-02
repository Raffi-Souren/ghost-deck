/**
 * Deck component
 * Represents one audio deck (A or B).
 */

import { useRef, useState, useCallback } from "react";
import type { AudioEngine, DeckId } from "../engine/AudioEngine";
import type { TraceRecorder } from "../engine/TraceRecorder";
import { useDeckState } from "../hooks/useDeckState";
import { Visualiser } from "./Visualiser";

interface Props {
  id: DeckId;
  engine: AudioEngine;
  recorder: TraceRecorder;
  ghostGain?: number;      // value from ghost overlay (undefined = no ghost)
  ghostFilter?: number;
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function Deck({ id, engine, recorder, ghostGain, ghostFilter }: Props) {
  const state = useDeckState(engine, id);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const objectUrlRef = useRef<string>("");

  const loadFile = useCallback(
    async (file: File) => {
      setError("");
      if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|wav|ogg|flac|aac|m4a)$/i)) {
        setError("UNSUPPORTED FORMAT");
        return;
      }
      try {
        // Revoke previous object URL
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const arrayBuffer = await file.arrayBuffer();
        await engine.loadBuffer(id, arrayBuffer);
        setFileName(file.name);
      } catch (e) {
        setError("DECODE ERROR");
        console.error(e);
      }
    },
    [engine, id]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = ""; // allow re-select same file
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const handlePlayPause = () => {
    engine.resume();
    if (state.isPlaying) {
      engine.pause(id);
      recorder.record(id, "pause", 0);
    } else {
      engine.play(id);
      recorder.record(id, "play", 1);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    engine.seek(id, val);
    recorder.record(id, "seek", val);
  };

  const handleGain = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    engine.setGain(id, val);
    recorder.record(id, "gain", val);
  };

  const handleFilter = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    engine.setFilter(id, val);
    recorder.record(id, "filter", val);
  };

  const hasTrack = engine.hasBuffer(id);
  const progress = state.duration > 0 ? state.currentTime / state.duration : 0;

  return (
    <div
      className={`deck deck-${id.toLowerCase()} ${isDragOver ? "deck--dragover" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="deck-header">
        <span className="deck-label">DECK {id}</span>
        {hasTrack && <span className="deck-loaded">● LOADED</span>}
      </div>

      {/* File loader */}
      <div className="deck-loader">
        <label className="btn btn-file">
          LOAD TRACK
          <input type="file" accept="audio/*" onChange={handleFileInput} hidden />
        </label>
        <span className="deck-filename">
          {error ? <span className="error">{error}</span> : (fileName || "DROP AUDIO HERE")}
        </span>
      </div>

      {/* Visualiser */}
      <div className="visualiser-wrap">
        <Visualiser
          analyser={engine.getAnalyser(id)}
          color={id === "A" ? "#00ff99" : "#ff6600"}
        />
      </div>

      {/* Progress bar */}
      <div className="progress-row">
        <span className="timecode">{fmt(state.currentTime)}</span>
        <input
          type="range"
          className="seek-bar"
          min={0}
          max={state.duration || 1}
          step={0.01}
          value={state.currentTime}
          onChange={handleSeek}
          disabled={!hasTrack}
        />
        <span className="timecode">{fmt(state.duration)}</span>
      </div>

      {/* Play/Pause */}
      <button
        className={`btn btn-play ${state.isPlaying ? "btn-play--active" : ""}`}
        onClick={handlePlayPause}
        disabled={!hasTrack}
      >
        {state.isPlaying ? "⏸ PAUSE" : "▶ PLAY"}
      </button>

      {/* Gain */}
      <div className="knob-row">
        <label className="knob-label">GAIN</label>
        <div className="knob-track-wrap">
          <input
            type="range"
            className="knob-range"
            min={0}
            max={1.5}
            step={0.01}
            value={state.gain}
            onChange={handleGain}
          />
          {ghostGain !== undefined && (
            <div
              className="ghost-marker"
              style={{ left: `${(ghostGain / 1.5) * 100}%` }}
              title={`GHOST GAIN: ${ghostGain.toFixed(2)}`}
            />
          )}
        </div>
        <span className="knob-value">{state.gain.toFixed(2)}</span>
      </div>

      {/* Low-pass filter */}
      <div className="knob-row">
        <label className="knob-label">LPF</label>
        <div className="knob-track-wrap">
          <input
            type="range"
            className="knob-range"
            min={200}
            max={20000}
            step={50}
            value={state.filterFreq}
            onChange={handleFilter}
          />
          {ghostFilter !== undefined && (
            <div
              className="ghost-marker"
              style={{ left: `${((ghostFilter - 200) / (20000 - 200)) * 100}%` }}
              title={`GHOST FILTER: ${Math.round(ghostFilter)}Hz`}
            />
          )}
        </div>
        <span className="knob-value">{Math.round(state.filterFreq)}Hz</span>
      </div>

      <div className="progress-px">
        <div className="progress-px-fill" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}
