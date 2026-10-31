/**
 * Live chips: what each typed piece was read as, with its exact span. Fast
 * enough to run on every keystroke (no facts, no questions).
 */
import type { ChipKind, LanguageChip } from "@elyia/core/api/language";
import type { Tok } from "./types.js";
import { venueById } from "./venues.js";

const NETWORK_NAMES: Readonly<Record<string, string>> = Object.freeze({ elysium: "Elysium", hyperevm: "HyperEVM", hypercore: "HyperCore", hyperliquid: "Hyperliquid" });

function chipOf(tok: Tok, previous: Tok | undefined): { kind: ChipKind; value?: string } | null {
  switch (tok.k) {
    case "verb":
      return { kind: tok.verb === "alert" ? "alert" : tok.verb === "show" ? "query" : "verb", value: tok.verb };
    case "side":
      return { kind: "side", value: tok.side };
    case "num": {
      const atPrice = previous && ((previous.k === "prep" && previous.role === "at") || (previous.k === "order" && previous.t === "limit"));
      const trigger = previous && previous.k === "tpsl";
      const value = `${tok.neg ? "-" : ""}${tok.usd ? "$" : ""}${tok.value}${tok.pct ? "%" : ""}`;
      return { kind: trigger ? "trigger" : atPrice ? "price" : "amount", value };
    }
    case "asset":
      return { kind: "asset", value: tok.lookalike ? `${tok.symbol} (not ${tok.lookalike})` : tok.symbol };
    case "market":
      return { kind: "market", value: `${tok.dex ? `${tok.dex}:` : ""}${tok.coin}${tok.kind === "spot" ? " spot" : tok.kind === "perp" ? " perp" : ""}` };
    case "network":
      return { kind: "network", value: NETWORK_NAMES[tok.family] ?? tok.family };
    case "account":
      return { kind: "account", value: tok.cls === "perp" ? "HyperCore perps" : "HyperCore spot" };
    case "venue":
      return { kind: "venue", value: venueById(tok.id)?.label ?? tok.id };
    case "lev":
      return { kind: "leverage", value: tok.invalid ? `${tok.invalid}x` : tok.x === "max" ? "max" : `${tok.x}x` };
    case "levword":
      return { kind: "leverage" };
    case "margin":
      return { kind: "margin", value: tok.mode };
    case "order":
      return { kind: "order", value: tok.t };
    case "tpsl":
      return { kind: "trigger", value: tok.kind === "tp" ? "take profit" : "stop loss" };
    case "dur":
      return { kind: "duration", value: `${tok.minutes} min` };
    case "sched":
      return { kind: "schedule", value: `every ${tok.seconds}s` };
    case "clock":
      return { kind: "schedule", value: `${String(tok.hour).padStart(2, "0")}:${String(tok.minute).padStart(2, "0")}${tok.tz ? ` ${tok.tz}` : ""}` };
    case "times":
      return { kind: "schedule", value: `${tok.n} times` };
    case "forDays":
      return { kind: "schedule", value: `${tok.days} days` };
    case "cond":
    case "condEnd":
    case "metric":
    case "period":
      return { kind: "condition", ...(tok.k === "metric" ? { value: tok.metric } : tok.k === "period" ? { value: tok.period } : {}) };
    case "cmp":
      return { kind: "condition", value: tok.op };
    case "qty":
      return { kind: "amount", value: tok.q };
    case "scope":
      return { kind: "market", value: tok.what };
    case "query":
      return { kind: "query", ...(tok.what ? { value: tok.what } : {}) };
    case "addr":
    case "name":
      return { kind: "recipient", value: tok.value };
    case "conn":
      return { kind: "connector", value: tok.c };
    case "unknown":
      return { kind: "unknown" };
    default:
      return null;
  }
}

export function chipsOf(text: string, tokens: readonly Tok[]): LanguageChip[] {
  const out: LanguageChip[] = [];
  let previous: Tok | undefined;
  for (const tok of tokens) {
    const chip = chipOf(tok, previous);
    if (tok.k !== "noise") previous = tok;
    if (!chip) continue;
    out.push({ text: text.slice(tok.span[0], tok.span[1]), kind: chip.kind, span: tok.span, ...(chip.value !== undefined ? { value: chip.value } : {}) });
  }
  return out;
}
