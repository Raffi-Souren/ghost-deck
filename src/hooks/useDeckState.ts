/**
 * useDeckState
 * Polls DeckState from the AudioEngine at ~30 fps for UI updates.
 */

import { useState, useEffect } from "react";
import type { AudioEngine, DeckId, DeckState } from "../engine/AudioEngine";

const POLL_MS = 33;

export function useDeckState(engine: AudioEngine, deck: DeckId): DeckState {
  const [state, setState] = useState<DeckState>(() => engine.getDeckState(deck));

  useEffect(() => {
    const id = setInterval(() => {
      setState(engine.getDeckState(deck));
    }, POLL_MS);
    return () => clearInterval(id);
  }, [engine, deck]);

  return state;
}
