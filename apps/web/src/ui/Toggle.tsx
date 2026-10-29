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

/** On/off switch (role="switch"). */
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
          "relative inline-flex shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-base ease-pluck disabled:cursor-not-allowed disabled:opacity-50",
          small ? "h-5 w-9" : "h-6 w-11",
          checked ? "border-violet-glow/60 bg-violet-fill" : "border-line-strong bg-bg-2",
          FOCUS_RING,
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "inline-block rounded-full bg-white shadow transition-transform duration-base ease-pluck",
            small ? "h-3.5 w-3.5" : "h-4 w-4",
            checked ? (small ? "translate-x-[18px]" : "translate-x-[22px]") : "translate-x-[3px]",
          )}
        />
      </button>
      <span className={cx("flex min-w-0 flex-col", hideLabel && "sr-only")}>
        <span id={`${id}-label`} className="text-sm text-text-0">
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-xs text-text-2">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
