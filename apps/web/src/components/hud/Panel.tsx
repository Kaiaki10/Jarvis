import type { ReactNode } from "react";

function CornerBrackets() {
  return (
    <>
      <span className="hud-corner top-0 left-0 border-t border-l" />
      <span className="hud-corner top-0 right-0 border-t border-r" />
      <span className="hud-corner bottom-0 left-0 border-b border-l" />
      <span className="hud-corner bottom-0 right-0 border-b border-r" />
    </>
  );
}

export function Panel({
  eyebrow = "SYSTEM //",
  title,
  children,
  className = "",
  bodyClassName = "",
}: {
  eyebrow?: string;
  title?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div
      className={`relative border border-cyan-500/20 bg-black/30 backdrop-blur-sm ${className}`}
    >
      <CornerBrackets />
      {title && (
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-cyan-500/10">
          <span className="text-[10px] tracking-[0.25em] text-cyan-400/60 uppercase">
            {eyebrow}
          </span>
          <span className="text-[10px] tracking-[0.2em] text-cyan-200/80 uppercase">
            {title}
          </span>
        </div>
      )}
      <div className={`p-4 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
