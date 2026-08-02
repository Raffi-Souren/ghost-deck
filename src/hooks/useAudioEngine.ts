/**
 * useAudioEngine
 * Singleton hook — creates the AudioEngine once per app lifetime.
 */

import { useRef } from "react";
import { AudioEngine } from "../engine/AudioEngine";

let _engine: AudioEngine | null = null;

export function useAudioEngine(): AudioEngine {
  const ref = useRef<AudioEngine | null>(null);
  if (!ref.current) {
    if (!_engine) _engine = new AudioEngine();
    ref.current = _engine;
  }
  return ref.current;
}
