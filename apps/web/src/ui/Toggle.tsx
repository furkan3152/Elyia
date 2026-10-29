import React, { useId } from "react";

import { cx, FOCUS_RING } from "./cx";

export interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly disabled?: boolean;
  /** Hide the visible label (it stays the accessible name). */
  readonly hideLabel?: boolean;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

/** On/off switch (role="switch"): an ink slot with a yellow nub that slides across; ON fills the slot with ink. */
export function Toggle({ checked, onChange, label, description, disabled, hideLabel = false, size = "md", className }: ToggleProps) {
  const id = useId();
  const small = size === "sm";
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex shrink-0 items-center border-2 border-rule transition-[background-color] duration-base ease-standard disabled:cursor-not-allowed disabled:opacity-50",
          small ? "h-5 w-9" : "h-6 w-11",
          checked ? "bg-ink" : "bg-paper-2",
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "inline-block border-2 border-rule transition-transform duration-base ease-spring",
            small ? "h-3 w-3" : "h-4 w-4",
            checked ? cx("bg-signal", small ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-[1px] bg-card",
          )}
        />
      </button>
      <span className={cx("flex min-w-0 flex-col", hideLabel && "sr-only")}>
        <span id={`${id}-label`} className="text-sm font-medium text-ink">
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-xs text-ink-3">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
