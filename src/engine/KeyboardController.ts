/**
 * KeyboardController
 *
 * Maps keyboard shortcuts to ControlBus dispatches (source = "keyboard").
 * Attaches/detaches document event listeners — call destroy() on cleanup.
 *
 * Default bindings:
 *   Q / W       → Deck A play / pause
 *   O / P       → Deck B play / pause
 *   A / S       → Deck A gain down / up  (±0.05)
 *   K / L       → Deck B gain down / up  (±0.05)
 *   Z / X       → Deck A LPF down / up   (perceptual step)
 *   M / ,       → Deck B LPF down / up   (perceptual step)
 *   ← / →       → Crossfader left / right (±0.05)
 *   Space       → Deck A play/pause toggle (mirrors Q/W)
 */

import type { ControlBus } from "./ControlBus";
import type { AudioEngine }  from "./AudioEngine";
import { filterHzToUnit, filterUnitToHz } from "./AudioMath";

export class KeyboardController {
  private _handler: (e: KeyboardEvent) => void;
  private enabled = true;

  constructor(bus: ControlBus, engine: AudioEngine) {
    this._handler = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;

      const stateA = engine.getDeckState("A");
      const stateB = engine.getDeckState("B");
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.repeat && (key === "q" || key === "w" || key === "o" || key === "p" || key === " ")) {
        return;
      }

      switch (key) {
        // ── Deck A ──────────────────────────────
        case "q":
          if (engine.hasBuffer("A")) bus.dispatch("A", "play", 1, "keyboard"); break;
        case "w":
          if (stateA.isPlaying) bus.dispatch("A", "pause", 0, "keyboard"); break;
        case " ":
          e.preventDefault();
          if (stateA.isPlaying) bus.dispatch("A", "pause", 0, "keyboard");
          else if (engine.hasBuffer("A")) bus.dispatch("A", "play", 1, "keyboard");
          break;
        case "a":
          bus.dispatch("A", "gain", Math.max(0, stateA.gain - 0.05), "keyboard"); break;
        case "s":
          bus.dispatch("A", "gain", Math.min(1.5, stateA.gain + 0.05), "keyboard"); break;
        case "z":
          bus.dispatch("A", "filter", filterUnitToHz(filterHzToUnit(stateA.filterFreq) - 0.05), "keyboard"); break;
        case "x":
          bus.dispatch("A", "filter", filterUnitToHz(filterHzToUnit(stateA.filterFreq) + 0.05), "keyboard"); break;

        // ── Deck B ──────────────────────────────
        case "o":
          if (engine.hasBuffer("B")) bus.dispatch("B", "play", 1, "keyboard"); break;
        case "p":
          if (stateB.isPlaying) bus.dispatch("B", "pause", 0, "keyboard"); break;
        case "k":
          bus.dispatch("B", "gain", Math.max(0, stateB.gain - 0.05), "keyboard"); break;
        case "l":
          bus.dispatch("B", "gain", Math.min(1.5, stateB.gain + 0.05), "keyboard"); break;
        case "m":
          bus.dispatch("B", "filter", filterUnitToHz(filterHzToUnit(stateB.filterFreq) - 0.05), "keyboard"); break;
        case ",":
          bus.dispatch("B", "filter", filterUnitToHz(filterHzToUnit(stateB.filterFreq) + 0.05), "keyboard"); break;

        // ── Crossfader ───────────────────────────
        case "ArrowLeft":
          e.preventDefault();
          bus.dispatch("master", "crossfader",
            Math.max(0, engine.crossfaderValue - 0.05), "keyboard"); break;
        case "ArrowRight":
          e.preventDefault();
          bus.dispatch("master", "crossfader",
            Math.min(1, engine.crossfaderValue + 0.05), "keyboard"); break;
      }
    };

    document.addEventListener("keydown", this._handler);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  destroy() {
    document.removeEventListener("keydown", this._handler);
  }
}
