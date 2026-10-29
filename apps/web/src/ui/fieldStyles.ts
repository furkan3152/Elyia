import { cx } from "./cx";

/** The bordered box around an input; the focus ring follows focus-within. */
export function fieldBoxClasses(options: { readonly invalid?: boolean; readonly size?: "sm" | "md" | "lg"; readonly disabled?: boolean } = {}): string {
  return cx(
    "flex w-full min-w-0 items-center gap-2 rounded-lg border bg-bg-2/60 px-3 transition-[border-color,box-shadow,background-color] duration-fast ease-pluck",
    options.size === "sm" ? "h-8 text-[13px]" : options.size === "lg" ? "h-12 text-base" : "h-10 text-sm",
    options.invalid
      ? "border-rose/60 focus-within:shadow-[0_0_0_3px_rgb(var(--rose)/0.18)]"
      : "border-line-strong hover:border-violet-glow/30 focus-within:border-violet-glow/70 focus-within:shadow-[0_0_0_3px_rgb(var(--violet)/0.18)]",
    options.disabled && "opacity-50",
  );
}
