import type { Tone } from "../ui/tones";
import type { ChipKind, PreviewToken } from "./preview";

const KIND_TONE: Readonly<Record<ChipKind, Tone>> = {
  verb: "mint",
  amount: "violet",
  asset: "sky",
  leverage: "gold",
  network: "neutral",
  trigger: "rose",
  schedule: "gold",
  connector: "neutral",
  word: "neutral",
};

const SELLING = new Set(["short", "sell", "close", "reduce", "flatten", "unstake", "withdraw", "cancel"]);

export function toneForToken(token: PreviewToken): Tone {
  if (token.kind === "verb" && SELLING.has(token.text.toLowerCase().replace(/[^a-z]/gu, ""))) return "rose";
  return KIND_TONE[token.kind];
}
