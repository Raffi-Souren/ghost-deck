export function GhostMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M12 53V26C12 14.95 20.95 6 32 6s20 8.95 20 20v27l-10-7-10 7-10-7-10 7Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M24 23v10m16-10v10" stroke="currentColor" strokeWidth="5" />
      <path d="M2 38h12l7-8 9 14 9-12 7 6h16" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
