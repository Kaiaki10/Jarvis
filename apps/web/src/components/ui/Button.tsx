import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "icon";

const VARIANT_CLASSES: Record<Variant, string> = {
  // The lit top edge is what separates a raised control from a flat colour swatch.
  primary:
    "bg-gradient-to-b from-accent-bright to-accent text-white shadow-elev-1 " +
    "ring-1 ring-inset ring-white/15 hover:brightness-110 active:brightness-95 " +
    "disabled:from-accent/40 disabled:to-accent/40 disabled:shadow-none",
  secondary:
    "bg-surface-hover text-foreground border border-border-strong hover:bg-white/10 " +
    "hover:border-white/20 disabled:opacity-40",
  ghost:
    "text-muted hover:text-foreground hover:bg-white/[0.06] disabled:opacity-40",
  destructive:
    "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 " +
    "hover:border-danger/50 disabled:opacity-40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-label gap-1.5",
  md: "h-9 px-4 text-body gap-2",
  icon: "h-9 w-9",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-[filter,background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
