import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEngine } from "./AudioEngine";
import { ControlBus, type ControlEvent } from "./ControlBus";
import { KeyboardController } from "./KeyboardController";

class TestElement {
  tagName: string;
  role?: string;
  parent?: TestElement;

  constructor(tagName: string, role?: string, parent?: TestElement) {
    this.tagName = tagName;
    this.role = role;
    this.parent = parent;
  }

  closest(selectors: string): TestElement | null {
    const matches = selectors.split(",").some((selector) => {
      const value = selector.trim();
      return value === this.tagName || (this.role !== undefined && value === `[role='${this.role}']`);
    });
    return matches ? this : this.parent?.closest(selectors) ?? null;
  }
}

describe("KeyboardController focus handling", () => {
  let controller: KeyboardController;
  let received: ControlEvent[];
  let listeners: Map<string, Set<(event: KeyboardEvent) => void>>;

  beforeEach(() => {
    listeners = new Map();
    vi.stubGlobal("Element", TestElement);
    vi.stubGlobal("document", {
      addEventListener(type: string, listener: (event: KeyboardEvent) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: (event: KeyboardEvent) => void) {
        listeners.get(type)?.delete(listener);
      },
    });

    const engine = {
      crossfaderValue: 0.5,
      getDeckState: () => ({ isPlaying: false, gain: 1, filterFreq: 20_000 }),
      hasBuffer: () => true,
    } as unknown as AudioEngine;
    const bus = new ControlBus(() => 0);
    received = [];
    bus.subscribe((event) => received.push(event));
    controller = new KeyboardController(bus, engine);
  });

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
  });

  function keydown(key: string, target = new TestElement("section"), defaultPrevented = false) {
    const event = {
      key,
      target,
      defaultPrevented,
      repeat: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const listener of listeners.get("keydown") ?? []) {
      listener(event as unknown as KeyboardEvent);
    }
    return event;
  }

  it.each(["ArrowRight", "q", " "])("ignores an already handled %j key", (key) => {
    keydown(key, new TestElement("section"), true);
    expect(received).toEqual([]);
  });

  it.each([
    ["waveform slider", new TestElement("canvas", "slider")],
    ["disclosure summary", new TestElement("summary")],
    ["link", new TestElement("a")],
    ["content inside a link", new TestElement("span", undefined, new TestElement("a"))],
  ])("preserves native keyboard behavior on a focused %s", (_label, target) => {
    for (const key of ["ArrowRight", "q", " "]) {
      const event = keydown(key, target as TestElement);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(received).toEqual([]);
  });

  it("still moves the crossfader when an ordinary page element receives an arrow key", () => {
    const event = keydown("ArrowRight");
    expect(event.defaultPrevented).toBe(true);
    expect(received).toEqual([{
      timestampMs: 0,
      deck: "master",
      control: "crossfader",
      value: 0.55,
      source: "keyboard",
    }]);
  });
});
