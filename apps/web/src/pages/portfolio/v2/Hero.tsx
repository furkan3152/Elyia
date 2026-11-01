import { useState } from "react";

import { cx } from "../../../ui/cx";
import { altimeterDigits } from "./model";

export interface HeroPill {
  readonly tone: "up" | "dn" | "acc" | "sig" | "mute";
  readonly text: string;
}

/** The value before the last change (React's "previous props" pattern): the digits that differ from it are the ones that roll. */
function usePrevious(value: number): number | null {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<number | null>(null);
  if (current !== value) {
    setPrevious(current);
    setCurrent(value);
  }
  return previous;
}

/**
 * The altimeter hero: net worth in digit blocks (only the digits that
 * changed turn sun and roll, in steps), then the pills. Up and down always
 * carry ▲ / ▼, never colour alone.
 */
export function Hero({ tag, value, pills }: { readonly tag: string; readonly value: number; readonly pills: readonly HeroPill[] }) {
  const previous = usePrevious(value);
  const digits = altimeterDigits(value, previous);
  const label = `Net worth $${Math.round(value).toLocaleString("en-US")}`;
  return (
    <div className="flex flex-col items-center gap-4 pb-2 pt-10 text-center sm:pt-12">
      <span className="tagchip">{tag}</span>
      <div className="digits num" role="img" aria-label={label}>
        <span aria-hidden="true">$</span>
        {digits.chars.map((char, index) =>
          char === "," ? (
            <span key={`sep-${index}`} className="sep" aria-hidden="true">
              ,
            </span>
          ) : (
            <span key={`${index}-${char}`} className={cx(digits.changed[index] && "hi")} aria-hidden="true">
              <i className={cx(digits.changed[index] && "px-digit-roll-up")}>{char}</i>
            </span>
          ),
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {pills.map((pill) => (
          <span key={pill.text} className={cx("pill", pill.tone)}>
            {pill.text}
          </span>
        ))}
      </div>
    </div>
  );
}
