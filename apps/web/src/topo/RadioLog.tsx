import React from "react";

import { cx } from "../ui/cx";

export type RadioTone = "plain" | "alert" | "settled" | "refused";

export interface RadioEntry {
  readonly id: string;
  /** "13:12:40" (or ms since epoch; formatted as HH:MM:SS). */
  readonly at: string | number;
  /** Call sign: "GUIDE", "BASE", "FLOOR", "ALERT". */
  readonly from: string;
  readonly to?: string;
  readonly message: React.ReactNode;
  readonly tone?: RadioTone;
  /** The live line (what is happening now): highlighted. */
  readonly live?: boolean;
}

export interface RadioLogProps {
  readonly entries: readonly RadioEntry[];
  /** Header caption ("RADIO LOG · BASE CAMP"). */
  readonly title?: React.ReactNode;
  readonly aside?: React.ReactNode;
  /** Footer line ("next · W4 needs your signature"). */
  readonly footer?: React.ReactNode;
  readonly maxHeight?: string;
  readonly className?: string;
}

const TONE: Readonly<Record<RadioTone, string>> = {
  plain: "text-ink",
  alert: "text-down",
  settled: "text-up",
  refused: "text-down",
};

function clock(at: string | number): string {
  if (typeof at === "string") return at;
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Base-camp radio: short, timestamped, calm lines (time · FROM → TO ·
 * message). The agent feed and Telegram previews use it. New lines rise in;
 * the live line is highlighted.
 */
export function RadioLog({ entries, title = "Radio log · base camp", aside, footer, maxHeight, className }: RadioLogProps) {
  return (
    <section className={cx("bg-card px-frame", className)}>
      <header className="flex items-center justify-between gap-3 border-b-2 border-rule px-4 py-2.5">
        <h3 className="caption !text-ink">{title}</h3>
        {aside ? <span className="font-tag text-[11px] uppercase text-ink-2">{aside}</span> : null}
      </header>
      <ol className="overflow-y-auto font-mono text-[13px] leading-snug" style={maxHeight ? { maxHeight } : undefined} aria-live="polite" aria-relevant="additions">
        {entries.map((entry) => (
          <li key={entry.id} className={cx("el-rise border-b-2 border-dashed border-rule px-4 py-1.5 last:border-b-0", entry.live && "bg-signal [&_*]:!text-signal-ink")}>
            <span className="tnum text-ink-3">{clock(entry.at)}</span> <span className={cx("font-tag text-[12px]", TONE[entry.tone ?? "plain"])}>{entry.from}</span>
            {entry.to ? <span className="text-ink-3"> → {entry.to}</span> : null}
            <span className="text-ink-3"> · </span>
            <span className="text-ink-2">{entry.message}</span>
          </li>
        ))}
      </ol>
      {footer ? <footer className="border-t-2 border-dashed border-rule px-4 py-2 font-mono text-xs text-ink-2">{footer}</footer> : null}
    </section>
  );
}
