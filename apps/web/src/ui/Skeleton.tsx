import { cx } from "./cx";

export interface SkeletonProps {
  readonly className?: string;
  /** Rounded pill (badges, avatars) instead of a block. */
  readonly round?: boolean;
}

/**
 * Loading placeholder: faint contour lines where the data will stand, never
 * a spinner. It breathes slowly (one breath per 2.4 s) and stops under
 * reduced motion.
 */
export function Skeleton({ className, round = false }: SkeletonProps) {
  return <span aria-hidden="true" className={cx("el-skeleton el-loop block", round && "rounded-full", className)} />;
}

export interface SkeletonTextProps {
  readonly lines?: number;
  readonly className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span className={cx("flex flex-col gap-2", className)} role="presentation">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx("h-3", index === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </span>
  );
}
