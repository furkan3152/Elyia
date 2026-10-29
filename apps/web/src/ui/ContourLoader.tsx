import { cx } from "./cx";

export interface ContourLoaderProps {
  /** px */
  readonly size?: number;
  readonly className?: string;
  /** Accessible status text; omit when the parent already says it is busy (aria-busy). */
  readonly label?: string;
}

/**
 * Elyia's "loading": three contour rings drawing on in turn, never a
 * spinner. Slow (one cycle per 1.6 s) and still under reduced motion.
 */
export function ContourLoader({ size = 16, className, label }: ContourLoaderProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx("el-contour-loader shrink-0", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
      stroke="currentColor"
    >
      <path pathLength={1} d="M3.5 13.5C3 8.5 7 4 12.2 4.2 17.6 4.4 21 8.4 20.4 13.2 19.8 18 15.6 20.6 11.4 20.2 7 19.8 3.9 17.6 3.5 13.5Z" strokeWidth="1.6" />
      <path pathLength={1} d="M7.4 12.9C7.2 9.9 9.4 7.7 12.2 7.8 15.1 7.9 16.9 10.1 16.6 12.8 16.3 15.4 14.1 16.8 11.8 16.6 9.4 16.4 7.6 15.3 7.4 12.9Z" strokeWidth="1.6" />
      <path pathLength={1} d="M10.6 12.5C10.6 11.4 11.3 10.9 12.1 10.9 13 10.9 13.6 11.6 13.5 12.5 13.4 13.3 12.7 13.7 12 13.6 11.2 13.5 10.6 13.2 10.6 12.5Z" strokeWidth="1.8" />
    </svg>
  );
}
