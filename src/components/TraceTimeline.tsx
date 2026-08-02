import { useEffect, useMemo, useRef, useState } from "react";
import type { ControlEvent, ControlName, TargetId } from "../engine/ControlBus";
import type { TraceSession } from "../engine/TraceRecorder";
import { filterHzToUnit } from "../engine/AudioMath";

interface Props {
  trace: TraceSession | null;
  isReplaying: boolean;
  getReplayProgressMs: () => number;
}

interface Lane {
  label: string;
  deck: TargetId;
  control: ControlName;
  initial: number;
  final: number;
  normalise: (value: number) => number;
  color: string;
  dashed?: boolean;
}

const WIDTH = 800;
const HEIGHT = 392;
const LEFT = 82;
const RIGHT = 786;
const TOP = 34;
const LANE_HEIGHT = 36;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function formatMs(milliseconds: number) {
  const totalSeconds = milliseconds / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function describeEvent(event: ControlEvent) {
  const target = event.deck === "master" ? "MASTER" : `DECK ${event.deck}`;
  const value = event.control === "filter"
    ? `${Math.round(event.value)} Hz`
    : event.control === "seek"
      ? `${event.value.toFixed(2)} s`
      : event.value.toFixed(3);
  return `${formatMs(event.timestampMs)} · ${target} · ${event.control.toUpperCase()} · ${value}`;
}

function sampleEvents(events: ControlEvent[], maximum = 600) {
  if (events.length <= maximum) return events;
  const step = Math.ceil(events.length / maximum);
  const sampled = events.filter((_, index) => index % step === 0);
  const last = events.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function buildStepPath(lane: Lane, events: ControlEvent[], durationMs: number, laneIndex: number) {
  const usableDuration = Math.max(1, durationMs);
  const yBase = TOP + laneIndex * LANE_HEIGHT;
  const yFor = (value: number) => yBase + (1 - clamp01(lane.normalise(value))) * 24;
  const xFor = (timestampMs: number) => LEFT + clamp01(timestampMs / usableDuration) * (RIGHT - LEFT);
  const relevant = sampleEvents(events.filter(
    (event) => event.deck === lane.deck && event.control === lane.control,
  ));

  let path = `M ${LEFT} ${yFor(lane.initial)}`;
  for (const event of relevant) {
    const x = xFor(event.timestampMs);
    path += ` H ${x} V ${yFor(event.value)}`;
  }
  path += ` H ${RIGHT} V ${yFor(lane.final)}`;
  return path;
}

export function TraceTimeline({ trace, isReplaying, getReplayProgressMs }: Props) {
  const cursorRef = useRef<SVGLineElement>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const sortedEvents = useMemo(() => trace
    ? trace.events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.timestampMs - b.event.timestampMs || a.index - b.index)
      .map(({ event }) => event)
    : [], [trace]);

  const lanes = useMemo<Lane[]>(() => trace ? [
    {
      label: "XFADE",
      deck: "master",
      control: "crossfader",
      initial: trace.initialState.crossfader,
      final: trace.finalState.crossfader,
      normalise: clamp01,
      color: "var(--accent-ghost)",
    },
    {
      label: "A GAIN",
      deck: "A",
      control: "gain",
      initial: trace.initialState.A.gain,
      final: trace.finalState.A.gain,
      normalise: (value) => value / 1.5,
      color: "var(--accent-a)",
    },
    {
      label: "A LPF",
      deck: "A",
      control: "filter",
      initial: trace.initialState.A.filterFreq,
      final: trace.finalState.A.filterFreq,
      normalise: filterHzToUnit,
      color: "var(--accent-a)",
      dashed: true,
    },
    {
      label: "A DELAY",
      deck: "A",
      control: "delay",
      initial: trace.initialState.A.delayMix,
      final: trace.finalState.A.delayMix,
      normalise: clamp01,
      color: "var(--accent-a)",
      dashed: true,
    },
    {
      label: "A SPACE",
      deck: "A",
      control: "reverb",
      initial: trace.initialState.A.reverbMix,
      final: trace.finalState.A.reverbMix,
      normalise: clamp01,
      color: "var(--accent-a)",
      dashed: true,
    },
    {
      label: "B GAIN",
      deck: "B",
      control: "gain",
      initial: trace.initialState.B.gain,
      final: trace.finalState.B.gain,
      normalise: (value) => value / 1.5,
      color: "var(--accent-b)",
    },
    {
      label: "B LPF",
      deck: "B",
      control: "filter",
      initial: trace.initialState.B.filterFreq,
      final: trace.finalState.B.filterFreq,
      normalise: filterHzToUnit,
      color: "var(--accent-b)",
      dashed: true,
    },
    {
      label: "B DELAY",
      deck: "B",
      control: "delay",
      initial: trace.initialState.B.delayMix,
      final: trace.finalState.B.delayMix,
      normalise: clamp01,
      color: "var(--accent-b)",
      dashed: true,
    },
    {
      label: "B SPACE",
      deck: "B",
      control: "reverb",
      initial: trace.initialState.B.reverbMix,
      final: trace.finalState.B.reverbMix,
      normalise: clamp01,
      color: "var(--accent-b)",
      dashed: true,
    },
  ] : [], [trace]);

  const paths = useMemo(() => trace
    ? lanes.map((lane, index) => buildStepPath(lane, trace.events, trace.durationMs, index))
    : [], [lanes, trace]);

  const transportEvents = useMemo(() => sampleEvents(
    sortedEvents.filter((event) => event.control === "play" || event.control === "pause" || event.control === "seek"),
    180,
  ), [sortedEvents]);

  useEffect(() => {
    setSelectedIndex(null);
  }, [trace]);

  useEffect(() => {
    if (!trace || !cursorRef.current) return;
    let frame = 0;
    let lastPaint = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frameInterval = reducedMotion ? 250 : 33;

    const paint = (now: number) => {
      if (now - lastPaint >= frameInterval) {
        const ratio = trace.durationMs > 0 ? clamp01(getReplayProgressMs() / trace.durationMs) : 0;
        const x = LEFT + ratio * (RIGHT - LEFT);
        cursorRef.current?.setAttribute("x1", String(x));
        cursorRef.current?.setAttribute("x2", String(x));
        lastPaint = now;
      }
      if (isReplaying) frame = requestAnimationFrame(paint);
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [getReplayProgressMs, isReplaying, trace]);

  const handleKeyboard = (event: React.KeyboardEvent<HTMLElement>) => {
    if (sortedEvents.length === 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(sortedEvents.length - 1, (current ?? -1) + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(0, (current ?? 1) - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedIndex(sortedEvents.length - 1);
    } else if (event.key === "Escape") {
      setSelectedIndex(null);
    }
  };

  const selected = selectedIndex === null ? null : sortedEvents[selectedIndex];
  const selectedX = trace && selected
    ? LEFT + clamp01(selected.timestampMs / Math.max(1, trace.durationMs)) * (RIGHT - LEFT)
    : null;

  return (
    <section
      className="trace-timeline"
      aria-labelledby="trace-path-title"
      tabIndex={0}
      onKeyDown={handleKeyboard}
    >
      <div className="trace-timeline-header">
        <h2 id="trace-path-title">TRACE PATH</h2>
        <span>{trace ? `${trace.events.length} EVENTS · ${(trace.durationMs / 1000).toFixed(2)}s` : "NO TRACE"}</span>
      </div>

      {!trace ? (
        <div className="trace-empty">NO TRACE IN MEMORY — RECORD OR IMPORT A TRANSITION</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trace-svg" aria-hidden="true">
            {lanes.map((lane, index) => {
              const y = TOP + index * LANE_HEIGHT;
              return (
                <g key={lane.label}>
                  <rect x={LEFT} y={y} width={RIGHT - LEFT} height={24} className="trace-lane-bg" />
                  <text x={8} y={y + 16} className="trace-lane-label">{lane.label}</text>
                  <path
                    d={paths[index]}
                    fill="none"
                    stroke={lane.color}
                    strokeWidth="2"
                    strokeDasharray={lane.dashed ? "5 4" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

            {transportEvents.map((event, index) => {
              const x = LEFT + clamp01(event.timestampMs / Math.max(1, trace.durationMs)) * (RIGHT - LEFT);
              const y = event.deck === "A" ? 368 : 384;
              const symbol = event.control === "play" ? "▶" : event.control === "pause" ? "Ⅱ" : "◆";
              return <text key={`${event.timestampMs}-${index}`} x={x} y={y} className={`trace-marker trace-marker--${event.deck.toLowerCase()}`}>{symbol}</text>;
            })}

            <line ref={cursorRef} x1={LEFT} x2={LEFT} y1={TOP - 5} y2={HEIGHT - 3} className="trace-cursor" />
            {selectedX !== null && (
              <line x1={selectedX} x2={selectedX} y1={TOP - 5} y2={HEIGHT - 3} className="trace-selection" />
            )}
          </svg>

          <div className="trace-ticks" aria-hidden="true">
            <span>00:00</span>
            <span>{formatMs(trace.durationMs / 2)}</span>
            <span>{formatMs(trace.durationMs)}</span>
          </div>
          <div className="trace-inspector" aria-live="polite">
            {selected ? describeEvent(selected) : "←/→ INSPECT EVENTS · A/B MARKERS: ▶ PLAY · Ⅱ PAUSE · ◆ SEEK"}
          </div>
        </>
      )}
    </section>
  );
}
