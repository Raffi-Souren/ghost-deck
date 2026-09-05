interface Props {
  trackCount: number;
  hasTrace: boolean;
  isRecording: boolean;
  isReplaying: boolean;
}

export function SessionGuide({ trackCount, hasTrace, isRecording, isReplaying }: Props) {
  const active = isReplaying || hasTrace ? 2 : trackCount > 0 || isRecording ? 1 : 0;
  const steps = [
    { title: "Set the scene", detail: trackCount ? `${trackCount} of 2 tracks loaded` : "Load your tracks or try the demo" },
    { title: "Make your move", detail: isRecording ? "Recording your controls now" : "Record, play, then mix A into B" },
    { title: "Meet your ghost", detail: isReplaying ? "Watch your moves play back" : hasTrace ? "Your trace is ready to replay" : "Stop to reveal your transition" },
  ];
  return (
    <ol className="session-guide" aria-label="Record and replay a transition">
      {steps.map((step, index) => (
        <li key={step.title} aria-current={index === active ? "step" : undefined}>
          <span className="session-step" aria-hidden="true">{index < active ? "✓" : `0${index + 1}`}</span>
          <div><strong>{step.title}</strong><span>{step.detail}</span></div>
        </li>
      ))}
    </ol>
  );
}
