import { cx } from "./cx";

export interface SkeletonProps {
  readonly className?: string;
  /** Rounded pill (badges, avatars) instead of a block. */
  readonly round?: boolean;
}

/** Loading placeholder: Elyia shows shape, never a spinner, while data arrives. */
export function Skeleton({ className, round = false }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "el-loop block animate-shimmer bg-[length:200%_100%] bg-[linear-gradient(90deg,rgb(var(--text-0)/0.04)_0%,rgb(var(--text-0)/0.1)_50%,rgb(var(--text-0)/0.04)_100%)]",
        round ? "rounded-full" : "rounded-md",
        className,
      )}
    />
  );
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
