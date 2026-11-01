import { useId, useState } from "react";

import { navigate } from "../../../app/routes/history";
import { cx, FOCUS_RING } from "../../../ui/cx";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

export interface WatchFieldProps {
  /** Where an address goes ("/app/portfolio/0x…" or "/app?as=0x…"). */
  readonly hrefFor: (address: string) => string;
  /** Example filled by the "try" link. */
  readonly example?: string;
  readonly label?: string;
  readonly size?: "md" | "lg";
  readonly className?: string;
}

/**
 * "Watch a range": any address, read only. Validated in place (plain words),
 * Enter goes; nothing is signed and nothing is stored.
 */
export function WatchField({ hrefFor, example, label = "Watch a range", size = "md", className }: WatchFieldProps) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (raw: string) => {
    const address = raw.trim();
    if (!ADDRESS.test(address)) {
      setError("That is not an address: 0x followed by 40 hex characters.");
      return;
    }
    setError(null);
    navigate(hrefFor(address.toLowerCase()));
  };
  const tall = size === "lg";
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        submit(value);
      }}
    >
      <div className={cx("flex w-full min-w-0 items-stretch bg-card px-frame px-drop", tall ? "h-12" : "h-11")}>
        <label htmlFor={id} className="flex shrink-0 items-center bg-ink px-3 font-tag text-[12px] uppercase text-paper">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          placeholder="0x… any address"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-3"
        />
        <button type="submit" className={cx("shrink-0 border-l-2 border-rule px-3 font-display text-[15px] font-bold text-ink hover:bg-paper-2", FOCUS_RING)}>
          Watch →
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-3 text-[13px] text-down" role="alert">
          {error}
        </p>
      ) : example ? (
        <p className="mt-3 font-mono text-[11px] text-ink-3">
          try{" "}
          <button type="button" className={cx("text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)} onClick={() => submit(example)}>
            {example.slice(0, 10)}…{example.slice(-6)}
          </button>{" "}
          · live testnet positions
        </p>
      ) : null}
    </form>
  );
}
