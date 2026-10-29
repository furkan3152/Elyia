import React from "react";

import { LayerChip } from "../ui/Badge";
import { cx } from "../ui/cx";
import type { Layer } from "./geometry/relief";

export interface RegisterRow {
  readonly id: string;
  /** "29 OCT 14:02". */
  readonly when: string;
  /** What happened, in plain words ("Bridged 20 HYPE up to the Summit"). */
  readonly entry: React.ReactNode;
  readonly layer: Layer;
  /** Signed amount text ("+1,000 USDC", "−0.30 HYPE"). */
  readonly amount?: string;
  readonly direction?: "up" | "down";
  /** Evidence link (explorer, HyperCore reference). */
  readonly proof?: { readonly label: string; readonly href: string };
}

export interface SummitRegisterProps {
  readonly rows: readonly RegisterRow[];
  /** What the register is (visually hidden table caption). */
  readonly caption: string;
  readonly empty?: React.ReactNode;
  readonly className?: string;
}

/**
 * The summit register: activity as a ruled log book. Numbered lines, a red
 * double margin rule, mono dates and amounts with ▲/▼ chevrons, and a proof
 * link on every line that settled.
 */
export function SummitRegister({ rows, caption, empty, className }: SummitRegisterProps) {
  return (
    <div className={cx("el-logbook relative overflow-x-auto border-2 border-rule bg-card", className)}>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
            <th scope="col" className="w-10 border-b-2 border-rule py-2 pl-4 pr-2 text-right font-medium">
              No.
            </th>
            <th scope="col" className="border-b-2 border-rule px-3 py-2 text-left font-medium">
              When
            </th>
            <th scope="col" className="border-b-2 border-rule px-3 py-2 text-left font-medium">
              Entry
            </th>
            <th scope="col" className="border-b-2 border-rule px-3 py-2 text-left font-medium">
              Where
            </th>
            <th scope="col" className="border-b-2 border-rule px-3 py-2 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="border-b-2 border-rule px-3 py-2 text-right font-medium">
              Proof
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className="align-baseline">
              <td className="tnum border-b border-rule/15 py-2 pl-4 pr-2 text-right font-mono text-[11px] text-ink-3">{String(index + 1).padStart(2, "0")}</td>
              <td className="tnum whitespace-nowrap border-b border-rule/15 px-3 py-2 font-mono text-xs text-ink-2">{row.when}</td>
              <td className="min-w-[14rem] border-b border-rule/15 px-3 py-2 text-ink">{row.entry}</td>
              <td className="whitespace-nowrap border-b border-rule/15 px-3 py-2">
                <LayerChip layer={row.layer} />
              </td>
              <td className={cx("tnum whitespace-nowrap border-b border-rule/15 px-3 py-2 text-right font-mono", row.direction === "up" ? "text-up" : row.direction === "down" ? "text-down" : "text-ink")}>
                {row.direction === "up" ? "▲ " : row.direction === "down" ? "▼ " : ""}
                {row.amount ?? "—"}
              </td>
              <td className="whitespace-nowrap border-b border-rule/15 px-3 py-2 text-right font-mono text-xs">
                {row.proof ? (
                  <a href={row.proof.href} target="_blank" rel="noopener noreferrer" className="text-summit-ink underline decoration-1 underline-offset-2 hover:text-ink">
                    {row.proof.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span className="text-ink-3">pending</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && empty ? <div className="p-4">{empty}</div> : null}
    </div>
  );
}
