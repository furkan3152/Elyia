/**
 * Base-camp radio (pure): the one bulletin the mini app leads with, picked
 * from the followed ropes. A fraying rope beats a missing anchor beats
 * calm. Every action is a link that drafts a route card to sign later in
 * the deck; nothing here signs.
 */
import type { Rope } from "../../features/trading/topo";

export type BulletinTone = "alert" | "caution" | "calm";

export interface BulletinAction {
  readonly label: string;
  /** Where the action goes (a route draft or a page). */
  readonly href: string | null;
  /** "mute" is handled in place. */
  readonly kind: "primary" | "secondary" | "mute";
}

export interface CampBulletin {
  /** Stable per situation, so a mute holds until the situation changes. */
  readonly id: string;
  readonly tone: BulletinTone;
  readonly title: string;
  readonly body: string;
  readonly grade: number;
  readonly actions: readonly BulletinAction[];
}

export interface BulletinLinks {
  readonly intent: (sentence: string) => string;
  readonly trade: (coin: string) => string;
}

function pctText(fraction: number): string {
  const value = fraction * 100;
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function priceText(value: number): string {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toPrecision(4);
}

export function campBulletin(ropes: readonly Pick<Rope, "coin" | "dex" | "side" | "leverage" | "distance" | "liquidationPx" | "sl" | "positionValue">[], links: BulletinLinks): CampBulletin {
  const sorted = [...ropes].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.positionValue - a.positionValue);
  const fraying = sorted.find((rope) => rope.distance !== null && rope.distance < 0.15);
  if (fraying && fraying.distance !== null) {
    const name = `${fraying.coin} ${fraying.leverage}×`;
    const where = fraying.liquidationPx !== null ? ` at ${priceText(fraying.liquidationPx)}` : "";
    return {
      id: `fray:${fraying.coin}:${Math.round(fraying.distance * 100)}`,
      tone: "alert",
      title: `Rope fraying · ${name}`,
      body: `Your ${fraying.side} is ${pctText(fraying.distance)} from the crevasse${where}. Close half (reduce-only) or add margin; the Guide drafts it, you sign.`,
      grade: fraying.leverage > 10 ? 5 : 3,
      actions: [
        { label: "Close half", href: links.intent(`close half my ${fraying.coin} position`), kind: "primary" },
        { label: "Add margin", href: links.trade(fraying.dex ? `${fraying.dex}:${fraying.coin}` : fraying.coin), kind: "secondary" },
        { label: "Mute 1 h", href: null, kind: "mute" },
      ],
    };
  }
  const loose = sorted.find((rope) => rope.sl === null && rope.distance !== null && rope.distance < 0.4);
  if (loose && loose.distance !== null) {
    return {
      id: `anchor:${loose.coin}`,
      tone: "caution",
      title: `No anchor · ${loose.coin} ${loose.leverage}×`,
      body: `${pctText(loose.distance)} of rope and no stop below you. An anchor at −5% caps the fall before the crevasse.`,
      grade: 2,
      actions: [
        { label: "Set anchor −5%", href: links.intent(`set a stop on ${loose.coin} at -5%`), kind: "primary" },
        { label: "Open terminal", href: links.trade(loose.dex ? `${loose.dex}:${loose.coin}` : loose.coin), kind: "secondary" },
        { label: "Mute 1 h", href: null, kind: "mute" },
      ],
    };
  }
  const count = ropes.length;
  return {
    id: `calm:${count}`,
    tone: "calm",
    title: count > 0 ? `All quiet · ${count} rope${count === 1 ? "" : "s"} out` : "All quiet on the range",
    body: count > 0 ? "Every rope has slack and an anchor. The radio calls you the moment one frays." : "No ropes out. Say where to and the Guide drafts the route.",
    grade: 1,
    actions: [{ label: "Where to?", href: null, kind: "primary" }],
  };
}

export const MUTE_MS = 60 * 60 * 1000;

/** Mutes are kept per bulletin id as an expiry; a new situation is never muted by an old mute. */
export function isMuted(mutes: Readonly<Record<string, number>>, id: string, now: number): boolean {
  const until = mutes[id];
  return typeof until === "number" && until > now;
}

export function parseMutes(raw: string | null, now: number): Record<string, number> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return {};
    const out: Record<string, number> = {};
    for (const [key, until] of Object.entries(value as Record<string, unknown>)) {
      if (typeof until === "number" && until > now && key.length < 120) out[key] = until;
    }
    return out;
  } catch {
    return {};
  }
}
