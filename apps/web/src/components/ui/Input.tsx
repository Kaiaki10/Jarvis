import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

/**
 * Fields sit *into* the surface rather than on top of it — an inset shadow plus
 * a darker fill, so a form reads as something you type into.
 */
const FIELD_CLASSES =
  "rounded-lg border border-border bg-black/25 px-3 py-2 text-body text-foreground " +
  "shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] outline-none " +
  "transition-[border-color,box-shadow,background-color] duration-150 " +
  "placeholder:text-muted " +
  "hover:border-border-strong " +
  "focus:border-accent/70 focus:bg-black/15 focus:shadow-[0_0_0_3px_var(--accent-glow)] " +
  "disabled:opacity-50";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLASSES} ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD_CLASSES} resize-none ${className}`} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${FIELD_CLASSES} cursor-pointer ${className}`} {...props}>
      {children}
    </select>
  );
}
