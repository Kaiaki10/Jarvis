export function CoreVisual({ active }: { active: boolean }) {
  return (
    <div className="relative h-56 w-56 shrink-0 mx-auto flex items-center justify-center">
      <div
        className={`absolute inset-0 rounded-full border border-dashed border-cyan-500/30 animate-spin-slow`}
      />
      <div
        className={`absolute inset-6 rounded-full border border-cyan-500/25 ${active ? "animate-spin-reverse" : ""}`}
      />
      <div className="absolute inset-14 rounded-full border border-cyan-400/30" />
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-500/10" />
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-500/10" />
      </div>
      <div
        className={`relative flex h-16 w-16 items-center justify-center rounded-full border box-glow ${
          active
            ? "border-cyan-300 bg-cyan-400/20 animate-hud-pulse"
            : "border-cyan-500/40 bg-cyan-500/5"
        }`}
      >
        <div className="h-2.5 w-2.5 rounded-full bg-cyan-300 box-glow" />
      </div>
      <div className="absolute bottom-6 text-center text-[10px] tracking-[0.25em] text-cyan-300/80 uppercase">
        Core
        <br />
        {active ? "Active" : "Standby"}
      </div>
    </div>
  );
}
