import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Small uppercase kicker above the title, for section context. */
  eyebrow?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-6 px-8 pt-9 pb-7">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 text-micro font-semibold tracking-[0.14em] text-muted uppercase">
            {eyebrow}
          </div>
        )}
        {/* Gradient falls off toward the baseline, so the title has some weight
            to it without shouting. */}
        <h1 className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-display text-transparent">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-body text-foreground-secondary">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}
