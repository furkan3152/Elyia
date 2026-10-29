/** Colour tones shared by badges, chips, stats and visuals. */
export type Tone = "violet" | "gold" | "mint" | "rose" | "sky" | "neutral";

/** Soft fill + border + text, the Oracle-chip recipe from the mockups. */
export const SOFT_TONE: Readonly<Record<Tone, string>> = {
  violet: "border-violet-glow/30 bg-violet-glow/[0.12] text-violet-soft",
  gold: "border-gold/30 bg-gold/[0.12] text-gold",
  mint: "border-mint/30 bg-mint/[0.12] text-mint",
  rose: "border-rose/30 bg-rose/[0.12] text-rose",
  sky: "border-sky/30 bg-sky/[0.12] text-sky",
  neutral: "border-line-strong bg-text-0/[0.05] text-text-1",
};

export const OUTLINE_TONE: Readonly<Record<Tone, string>> = {
  violet: "border-violet-glow/45 text-violet-soft",
  gold: "border-gold/45 text-gold",
  mint: "border-mint/40 text-mint",
  rose: "border-rose/40 text-rose",
  sky: "border-sky/40 text-sky",
  neutral: "border-line-strong text-text-1",
};

export const SOLID_TONE: Readonly<Record<Tone, string>> = {
  violet: "border-transparent bg-violet-fill text-ink-violet",
  gold: "border-transparent bg-gold-fill text-ink-gold",
  mint: "border-transparent bg-mint-fill text-ink-mint",
  rose: "border-transparent bg-rose-fill text-ink-rose",
  sky: "border-transparent bg-sky text-bg-0",
  neutral: "border-transparent bg-text-1 text-bg-0",
};

export const DOT_TONE: Readonly<Record<Tone, string>> = {
  violet: "bg-violet-glow",
  gold: "bg-gold",
  mint: "bg-mint",
  rose: "bg-rose",
  sky: "bg-sky",
  neutral: "bg-text-2",
};

export const TEXT_TONE: Readonly<Record<Tone, string>> = {
  violet: "text-violet-soft",
  gold: "text-gold",
  mint: "text-mint",
  rose: "text-rose",
  sky: "text-sky",
  neutral: "text-text-1",
};

/** Mint for positive, rose for negative, neutral for zero or unknown. */
export function signTone(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "mint" : "rose";
}
