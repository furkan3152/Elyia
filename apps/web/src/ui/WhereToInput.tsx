import React, { useId } from "react";

import { cx } from "./cx";

export interface WhereToInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** The blade's word (default "WHERE TO?"). */
  readonly blade?: string;
  /** Right side: key hint, submit button. */
  readonly aside?: React.ReactNode;
  readonly size?: "md" | "lg";
  readonly containerClassName?: string;
}

/**
 * The "WHERE TO?" signpost input: an ink blade with a pointed end, then a
 * mono line where you write the sentence. Used by the ⌘K command signpost,
 * the deck and the landing.
 */
export const WhereToInput = React.forwardRef<HTMLInputElement, WhereToInputProps>(function WhereToInput(
  { blade = "WHERE TO?", aside, size = "lg", id, className, containerClassName, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? `whereto-${autoId}`;
  const tall = size === "lg";
  return (
    <div
      className={cx(
        "group flex w-full min-w-0 items-stretch border-2 border-rule bg-card shadow-hard transition-[box-shadow,transform] duration-fast focus-within:-translate-x-px focus-within:-translate-y-px focus-within:shadow-hard-lg",
        tall ? "h-14" : "h-11",
        containerClassName,
      )}
    >
      <label
        htmlFor={inputId}
        className={cx(
          "el-blade relative flex shrink-0 items-center bg-ink pl-3.5 pr-6 font-sans font-bold uppercase tracking-[0.06em] text-paper",
          tall ? "text-base sm:text-lg" : "text-sm",
        )}
      >
        {blade}
      </label>
      <input
        ref={ref}
        id={inputId}
        autoComplete="off"
        spellCheck={false}
        className={cx(
          "h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-ink outline-none placeholder:text-ink-3",
          tall ? "text-[15px] sm:text-base" : "text-sm",
          className,
        )}
        {...rest}
      />
      {aside ? <div className="flex shrink-0 items-center gap-2 pr-2">{aside}</div> : null}
    </div>
  );
});
