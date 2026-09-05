import { useEffect, useMemo, useRef, useState } from "react";
import type { ControlEvent, ControlName, TargetId } from "../engine/ControlBus";
import type { TraceSession } from "../engine/TraceRecorder";
import { filterHzToUnit } from "../engine/AudioMath";

interface Props {
  trace: TraceSession | null;
  isReplaying: boolean;
  isRecording: boolean;
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

export function TraceTimeline({ trace, isReplaying, isRecording, getReplayProgressMs }: Props) {
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
    if (!["ArrowRight", "ArrowLeft", "Home", "End", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (sortedEvents.length === 0) return;
    if (event.key === "ArrowRight") {
      setSelectedIndex((current) => Math.min(sortedEvents.length - 1, (current ?? -1) + 1));
    } else if (event.key === "ArrowLeft") {
      setSelectedIndex((current) => Math.max(0, (current ?? 1) - 1));
    } else if (event.key === "Home") {
      setSelectedIndex(0);
    } else if (event.key === "End") {
      setSelectedIndex(sortedEvents.length - 1);
    } else if (event.key === "Escape") {
      setSelectedIndex(null);
    }
  };

  const handleTimelineClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!trace || sortedEvents.length === 0) return;
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return;

    // The SVG transform includes its responsive scale, border, and viewBox padding.
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    const timestampMs = clamp01((point.x - LEFT) / (RIGHT - LEFT)) * trace.durationMs;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < sortedEvents.length; index += 1) {
      const distance = Math.abs(sortedEvents[index].timestampMs - timestampMs);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    setSelectedIndex(nearestIndex);
    event.currentTarget.closest<HTMLElement>(".trace-timeline")?.focus({ preventScroll: true });
  };

  const selected = selectedIndex === null ? null : sortedEvents[selectedIndex];
  const selectedX = trace && selected
    ? LEFT + clamp01(selected.timestampMs / Math.max(1, trace.durationMs)) * (RIGHT - LEFT)
    : null;

  return (
    <section
      className="trace-timeline"
      aria-labelledby="trace-path-title"
      aria-describedby={trace ? "trace-inspector" : undefined}
      tabIndex={0}
      onKeyDown={handleKeyboard}
    >
      <div className="trace-timeline-header">
        <h2 id="trace-path-title">TRACE PATH</h2>
        <span>{trace ? `${trace.events.length} EVENTS · ${(trace.durationMs / 1000).toFixed(2)}s` : isRecording ? "● RECORDING" : "NO TRACE"}</span>
      </div>

      {!trace ? (
        <div className="trace-empty">
          <svg className="trace-empty-illustration" viewBox="0 0 176 60" width="176" height="60" aria-hidden="true">
            <path d="M 8 12 H 168 M 8 30 H 168 M 8 48 H 168" fill="none" stroke="var(--border)" />
            <path d="M 8 18 H 48 V 26 H 82 V 42 H 168" fill="none" stroke="var(--accent-a)" strokeWidth="2" />
            <path d="M 8 48 H 82 V 36 H 122 V 16 H 168" fill="none" stroke="var(--accent-b)" strokeWidth="2" />
            <path d="M 82 5 V 55" fill="none" stroke="var(--accent-ghost)" strokeDasharray="3 4" />
            <circle cx="82" cy="5" r="3" fill="var(--accent-ghost)" />
          </svg>
          <div className="trace-empty-copy">
            <h3 className="trace-empty-title">{isRecording ? "The moment is being captured." : "Your next transition starts here."}</h3>
            <p className="trace-empty-hint">{isRecording ? "Shape the sound. Move the crossfader. Press Stop to reveal your trace." : "Press Record, mix the decks, then Stop to see every move."}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="trace-chart-scroll">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trace-svg" aria-hidden="true" onClick={handleTimelineClick}>
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
          </div>
          <div className="trace-inspection">
            <div id="trace-inspector" className="trace-inspector" aria-live="polite">
              {selected ? describeEvent(selected) : sortedEvents.length > 0
                ? "Tap the trace or use ←/→ to inspect. A/B markers: ▶ play · Ⅱ pause · ◆ seek"
                : "No control moves were recorded. Record a new transition and move a mixer control."}
            </div>
            <div className="trace-event-controls" aria-label="Inspect recorded events">
              <button
                className="btn trace-event-button"
                type="button"
                aria-label="Previous recorded event"
                disabled={sortedEvents.length === 0 || selectedIndex === 0}
                onClick={() => setSelectedIndex((current) => Math.max(0, (current ?? 1) - 1))}
              >
                ← Previous
              </button>
              <span className="trace-event-count">
                {selectedIndex === null ? "—" : selectedIndex + 1} / {sortedEvents.length}
              </span>
              <button
                className="btn trace-event-button"
                type="button"
                aria-label="Next recorded event"
                disabled={sortedEvents.length === 0 || selectedIndex === sortedEvents.length - 1}
                onClick={() => setSelectedIndex((current) => Math.min(sortedEvents.length - 1, (current ?? -1) + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
