/** Small shared pieces of the Herd pages. */
import { cx } from "../../../ui/cx";

export type HerdTone = "up" | "acc" | "warn" | "dn" | "mute";

const TONE: Readonly<Record<HerdTone, string>> = {
  up: "bg-up/15 text-up",
  acc: "bg-accent/15 text-accent",
  warn: "bg-warn/20 text-warn-ink",
  dn: "bg-down/15 text-down",
  mute: "bg-paper-2 text-ink-2",
};

export function Chip({ tone = "mute", children, className }: { readonly tone?: HerdTone; readonly children: React.ReactNode; readonly className?: string }) {
  return <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap px-2 font-tag text-[10.5px] uppercase tracking-[0.04em]", TONE[tone], className)}>{children}</span>;
}

/** The testnet label: every Herd surface on testnet carries it. */
export function TestnetBadge({ testnet, className }: { readonly testnet: boolean; readonly className?: string }) {
  if (!testnet) return null;
  return (
    <Chip tone="warn" className={className}>
      <span aria-hidden="true" className="inline-block h-[6px] w-[6px] bg-warn-ink" />
      Testnet · test HYPE, no real value
    </Chip>
  );
}

/** A stepped bar in N blocks (no colour-only meaning: the label carries the number). */
export function BlockBar({ fraction, blocks = 20, label, tone = "acc" }: { readonly fraction: number; readonly blocks?: number; readonly label: string; readonly tone?: "acc" | "up" | "sig" }) {
  const filled = Math.max(0, Math.min(blocks, Math.round(fraction * blocks)));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="flex gap-[3px]">
      {Array.from({ length: blocks }, (_, index) => (
        <span key={index} className={cx("h-3 flex-1", index < filled ? (tone === "up" ? "bg-up" : tone === "sig" ? "bg-signal" : "bg-accent") : "bg-paper-3")} />
      ))}
    </div>
  );
}

export function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule py-1.5 text-[12.5px] last:border-b-0">
      <span className="font-tag text-[10px] uppercase tracking-[0.04em] text-ink-3">{label}</span>
      <span className="min-w-0 truncate text-right text-ink">{children}</span>
    </div>
  );
}
