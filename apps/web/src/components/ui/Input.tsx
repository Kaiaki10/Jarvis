import type { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

const FIELD_CLASSES =
  "rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent/60 focus:bg-white/[0.05]";

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
    <select className={`${FIELD_CLASSES} ${className}`} {...props}>
      {children}
    </select>
  );
}
