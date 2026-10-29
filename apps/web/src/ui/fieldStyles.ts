import { cx } from "./cx";

/** The bordered box around an input; the focus ring follows focus-within. */
export function fieldBoxClasses(options: { readonly invalid?: boolean; readonly size?: "sm" | "md" | "lg"; readonly disabled?: boolean } = {}): string {
  return cx(
    "flex w-full min-w-0 items-center gap-2 border-2 bg-card px-3 transition-[border-color,box-shadow,background-color] duration-fast ease-standard",
    options.size === "sm" ? "h-8 text-[13px]" : options.size === "lg" ? "h-12 text-base" : "h-10 text-sm",
    options.invalid
      ? "border-down focus-within:shadow-[3px_3px_0_rgb(var(--down))]"
      : "border-rule focus-within:shadow-hard focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-line",
    options.disabled && "opacity-50",
  );
}
