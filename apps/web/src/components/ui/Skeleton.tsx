/**
 * A pulsing placeholder for content that hasn't arrived yet.
 *
 * Sized entirely by `className` (width, height, radius) so each call site can
 * roughly match what it stands in for — that's what stops the layout jumping
 * once the real content replaces it, which a plain "Loading…" line can't do.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse-soft rounded-md bg-white/[0.06] ${className}`} />;
}

/** N skeleton rows shaped like a real icon-plus-two-lines list row. */
export function SkeletonRows({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
