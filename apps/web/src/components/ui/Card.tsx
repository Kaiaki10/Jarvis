import type { ReactNode } from "react";

/**
 * Elevation, not decoration. A card's level says how important it is on the
 * page: level 1 is the default panel, level 2 is the thing you came here for,
 * level 0 recedes into the background for supporting detail.
 */
type Elevation = 0 | 1 | 2;

const ELEVATION_CLASSES: Record<Elevation, string> = {
  0: "border-border/60 bg-surface/40",
  1: "border-border bg-surface/70 shadow-elev-1 backdrop-blur-sm",
  2: "surface-raised border-border-strong shadow-elev-2 backdrop-blur-sm",
};

export function Card({
  children,
  className = "",
  elevation = 1,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  elevation?: Elevation;
  /** Lifts on hover. Only for cards that are actually a link or a button. */
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-card border transition-[transform,box-shadow,border-color] duration-200 ${
        ELEVATION_CLASSES[elevation]
      } ${
        interactive
          ? "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elev-2"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Small leading glyph. Gives a dense page something to scan by. */
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-px shrink-0 text-muted">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-heading text-foreground">{title}</h2>
          {description && (
            <p className="mt-1 text-label text-muted">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-5 pb-5 ${className}`}>{children}</div>;
}
