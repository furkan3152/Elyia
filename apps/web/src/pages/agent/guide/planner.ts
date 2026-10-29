/**
 * The Guide's local planner (pure, deterministic). It answers questions
 * from the followed range's live data (ropes, exposure, funding, history)
 * and drafts proposals the user signs. It never signs, never invents a
 * number: every figure comes from the facts it was given, and the readings
 * it took are listed ("survey readings") so the user can check them.
 *
 * Whole sentences that are routes ("bridge 20 HYPE to Elysium") are handed
 * to the intent planner as a route card; alert and standing-order sentences
 * become rules the user arms.
 */
import { parseRuleSentence, ruleCondition, type ParsedRule } from "../../alerts/model/rules";

export type GuideSource = "api" | "browser" | "sample";

export interface GuideRope {
  readonly coin: string;
  readonly dex: string;
  readonly side: "long" | "short";
  readonly size: number;
  readonly entryPx: number;
  readonly markPx: number;
  readonly liquidationPx: number | null;
  readonly distance: number | null;
  readonly leverage: number;
  readonly positionValue: number;
  readonly unrealizedPnl: number;
  readonly sl: { readonly px: number } | null;
  readonly tp: { readonly px: number } | null;
}

export interface GuideExposure {
  readonly underlying: string;
  readonly netUsd: number | null;
  readonly perp: number;
  readonly spot: number;
  readonly lst: number;
  readonly isCash: boolean;
}

export interface GuideFacts {
  readonly source: GuideSource;
  readonly netWorth: number | null;
  readonly byLayer: { readonly floor: number; readonly ridge: number; readonly summit: number } | null;
  readonly ropes: readonly GuideRope[];
  readonly exposure: readonly GuideExposure[];
  /** Hourly funding by coin (fraction; + = longs pay shorts). */
  readonly funding: Readonly<Record<string, number>>;
  /** Funding actually paid (-) or received (+) over the last 24 h, USDC; null when unknown. */
  readonly funding24h: number | null;
  /** Realised PnL over the last 24 h, USDC; null when unknown. */
  readonly realized24h: number | null;
  readonly fills24h: number | null;
  /** One-line Rule Book summary ("max 20× · max $10,000 per order · every market"). */
  readonly ruleBook: string;
  readonly killSwitch: boolean;
}

export interface Reading {
  readonly label: string;
  readonly detail: string;
}

export type SegmentTone = "plain" | "strong" | "down" | "up";
export interface Segment {
  readonly text: string;
  readonly tone?: SegmentTone;
}

/** Something the user can sign or arm. */
export type Proposal =
  | {
      readonly kind: "anchor";
      readonly coin: string;
      readonly dex: string;
      readonly side: "long" | "short";
      readonly size: number;
      readonly entry: number;
      readonly mark: number;
      readonly liquidation: number | null;
      readonly currentStop: number | null;
      readonly takeProfit: number | null;
      /** The proposed stop (anchor). */
      readonly stop: number;
      /** USD lost if the anchor is hit, from the mark. */
      readonly maxLoss: number;
      /** Fraction of the mark between the anchor and the mark. */
      readonly stopDistance: number;
    }
  | { readonly kind: "halve"; readonly coin: string; readonly dex: string; readonly side: "long" | "short"; readonly size: number; readonly mark: number; /** 0.5 (default) or 1 (close it all). */ readonly fraction?: number }
  | { readonly kind: "route"; readonly sentence: string }
  | { readonly kind: "rule"; readonly parsed: ParsedRule; readonly sentence: string };

export type Topic = "riskiest" | "exposure" | "funding" | "summary" | "rule" | "route" | "killswitch" | "standing" | "help";

export interface GuideReply {
  readonly topic: Topic;
  readonly readings: readonly Reading[];
  readonly segments: readonly Segment[];
  readonly proposals: readonly Proposal[];
  /** Suggested next questions. */
  readonly followUps: readonly string[];
}

/* ----------------------------------------------------------- formatting */

export function usd(value: number, signed = false): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 0 : 2;
  const text = `$${abs.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
  if (!signed) return value < 0 ? `-${text}` : text;
  return `${value >= 0 ? "+" : "-"}${text}`;
}

export function px(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 10_000 ? 0 : abs >= 1_000 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : 5;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function pct(fraction: number, digits = 0): string {
  const value = (fraction * 100).toFixed(digits);
  return `${value === "-0" ? "0" : value}%`;
}

/** Five significant figures, the way HyperCore prices are written. */
export function roundPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value;
  const magnitude = Math.floor(Math.log10(value));
  const factor = 10 ** (4 - magnitude);
  return Math.round(value * factor) / factor;
}

/* ---------------------------------------------------------------- facts */

export function ropesByRisk(ropes: readonly GuideRope[]): GuideRope[] {
  return [...ropes].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.positionValue - a.positionValue);
}

/** USD per hour a position pays (-) or earns (+) at the current funding rate. */
export function fundingPerHour(rope: Pick<GuideRope, "coin" | "side" | "positionValue">, funding: Readonly<Record<string, number>>): number | null {
  const hourly = funding[rope.coin];
  if (hourly === undefined) return null;
  const pays = rope.side === "long" ? hourly : -hourly;
  return -pays * rope.positionValue;
}

/**
 * The anchor (stop) the Guide proposes: halfway between the mark and the
 * crevasse, so the fall stops well before liquidation. A rope without a
 * liquidation price gets an anchor 5% from the mark.
 */
export function proposedAnchor(rope: GuideRope): number {
  const { markPx: mark, liquidationPx: liq } = rope;
  const raw = liq !== null && liq > 0 ? mark + (liq - mark) * 0.5 : rope.side === "long" ? mark * 0.95 : mark * 1.05;
  return roundPrice(raw);
}

export function anchorProposal(rope: GuideRope): Extract<Proposal, { kind: "anchor" }> {
  const stop = proposedAnchor(rope);
  const maxLoss = Math.abs(stop - rope.markPx) * rope.size;
  return {
    kind: "anchor",
    coin: rope.coin,
    dex: rope.dex,
    side: rope.side,
    size: rope.size,
    entry: rope.entryPx,
    mark: rope.markPx,
    liquidation: rope.liquidationPx,
    currentStop: rope.sl?.px ?? null,
    takeProfit: rope.tp?.px ?? null,
    stop,
    maxLoss,
    stopDistance: Math.abs(stop - rope.markPx) / rope.markPx,
  };
}

/** True when an existing stop already sits between the mark and the crevasse. */
export function anchoredSafely(rope: GuideRope): boolean {
  if (!rope.sl) return false;
  if (rope.liquidationPx === null) return true;
  return rope.side === "long" ? rope.sl.px > rope.liquidationPx && rope.sl.px < rope.markPx : rope.sl.px < rope.liquidationPx && rope.sl.px > rope.markPx;
}

function ropeName(rope: GuideRope): string {
  return `${rope.coin} ${rope.leverage}× ${rope.side}`;
}

/* ------------------------------------------------------------- planning */

const RISK = /\b(riski|risky|weak|danger|liquidat|crevasse|rope|safe|margin call|blow up|wrecked)/u;
const EXPOSURE = /\b(expos|exposed|net long|net short|delta|concentrat|biggest|allocation|split)/u;
const FUNDING = /\b(funding|carry|pays? me|paying)\b/u;
const SUMMARY = /\b(worth|summary|overview|how am i|how's my|hows my|my range|portfolio|bulletin|morning|overnight|today)\b/u;
const ROUTE = /^(?:please\s+)?(long|short|buy|sell|bridge|swap|stake|unstake|move|send|deposit|withdraw|ascend|descend|close|flatten|lend|wrap)\b/u;
const KILL = /\b(kill switch|stop everything|stop every|panic|halt)\b/u;

export const STARTERS: readonly string[] = [
  "what's my riskiest rope right now?",
  "how exposed am I?",
  "what does funding cost me?",
  "alert me if ETH funding goes above 0.01%",
  "when any rope is under 10%, close half",
];

export function topicOf(question: string): Topic {
  const text = question.trim().toLowerCase();
  if (!text) return "help";
  if (KILL.test(text)) return "killswitch";
  if (parseRuleSentence(question) && /\b(alert|tell|ping|notify|when|whenever|if)\b/u.test(text) && !ROUTE.test(text)) return "rule";
  if (ROUTE.test(text)) return "route";
  if (RISK.test(text)) return "riskiest";
  if (FUNDING.test(text)) return "funding";
  if (EXPOSURE.test(text)) return "exposure";
  if (SUMMARY.test(text)) return "summary";
  return "help";
}

function sampleNote(facts: GuideFacts): Segment[] {
  return facts.source === "sample" ? [{ text: " (This is the sample range: connect a wallet or watch an address and I read yours.)" }] : [];
}

export function answer(question: string, facts: GuideFacts): GuideReply {
  const topic = topicOf(question);
  switch (topic) {
    case "riskiest":
      return riskiest(facts);
    case "exposure":
      return exposure(facts);
    case "funding":
      return fundingReply(facts);
    case "summary":
      return summary(facts);
    case "rule":
      return ruleReply(question, facts);
    case "route":
      return {
        topic,
        readings: [{ label: "read sentence", detail: `${question.trim().split(/\s+/u).length} words` }, { label: "your Rule Book", detail: facts.ruleBook }],
        segments: [
          { text: "That is a route, not a question. " },
          { text: "I drafted it as a route card", tone: "strong" },
          { text: ": every step quoted, checked against your Rule Book and signed by you, one at a time." },
        ],
        proposals: [{ kind: "route", sentence: question.trim() }],
        followUps: ["what's my riskiest rope right now?"],
      };
    case "killswitch":
      return {
        topic,
        readings: [{ label: "your Rule Book", detail: facts.killSwitch ? "kill switch on" : "kill switch off" }],
        segments: facts.killSwitch
          ? [{ text: "The kill switch is already on: " }, { text: "nothing new signs", tone: "strong" }, { text: ". Closing positions and cancelling orders still work. Release it from the switch on the right when you are ready." }]
          : [{ text: "The kill switch is the red bar on the right (or " }, { text: "Shift K", tone: "strong" }, { text: "). One tap pauses every standing order and stops the trading key signing anything new; closing and cancelling always work." }],
        proposals: [],
        followUps: ["what's my riskiest rope right now?"],
      };
    default:
      return help(facts);
  }
}

function riskiest(facts: GuideFacts): GuideReply {
  const ordered = ropesByRisk(facts.ropes);
  const readings: Reading[] = [
    { label: "read ropes", detail: String(facts.ropes.length) },
    { label: "liquidation prices", detail: "HyperCore" },
    { label: "funding", detail: `${Object.keys(facts.funding).length > 0 ? "live" : "waiting"}` },
    { label: "your Rule Book", detail: facts.ruleBook },
  ];
  const weak = ordered[0];
  if (!weak) {
    return {
      topic: "riskiest",
      readings,
      segments: [{ text: "No ropes out: there is no open position to fall from. " }, { text: "Your range is all solid ground.", tone: "strong" }, ...sampleNote(facts)],
      proposals: [],
      followUps: ["how exposed am I?", "long ETH 3x with 100 USDC, stop at -4%"],
    };
  }
  const perHour = fundingPerHour(weak, facts.funding);
  const segments: Segment[] = [{ text: "Your " }, { text: ropeName(weak), tone: weak.side === "short" ? "down" : "up" }, { text: " is the weak rope: " }];
  if (weak.distance === null) {
    segments.push({ text: "it has no liquidation price (fully collateralised), so there is no crevasse below it." });
    return { topic: "riskiest", readings, segments: [...segments, ...sampleNote(facts)], proposals: [], followUps: ["how exposed am I?"] };
  }
  segments.push({ text: `${pct(weak.distance, weak.distance < 0.1 ? 1 : 0)} to the crevasse`, tone: "strong" }, { text: ` (liquidation at ${px(weak.liquidationPx ?? 0)}, mark ${px(weak.markPx)})` });
  if (perHour !== null) segments.push(perHour >= 0 ? { text: `. Funding pays you ${usd(perHour)}/h to hold it, ` } : { text: `. It costs you ${usd(-perHour)}/h in funding, ` });
  else segments.push({ text: ", " });
  const anchored = anchoredSafely(weak);
  const proposals: Proposal[] = [];
  if (anchored && weak.sl) {
    segments.push({ text: `and your anchor at ${px(weak.sl.px)} already stops the fall before liquidation. ` });
    if (weak.distance < 0.1) {
      segments.push({ text: "The rope is short though: " }, { text: "halving it doubles the slack", tone: "strong" }, { text: "." });
      proposals.push({ kind: "halve", coin: weak.coin, dex: weak.dex, side: weak.side, size: weak.size, mark: weak.markPx });
    } else {
      segments.push({ text: "Nothing to do but watch it." });
    }
  } else if (weak.distance < 0.25) {
    const anchor = anchorProposal(weak);
    segments.push(
      { text: weak.sl ? `and your stop at ${px(weak.sl.px)} sits beyond the crevasse, so it would never fire. ` : "and nothing stops the fall. " },
      { text: "I would shorten the fall, not cut the climb", tone: "strong" },
      { text: `: an anchor at ${px(anchor.stop)} (reduce-only) caps the loss at about ${usd(anchor.maxLoss)} from here.` },
    );
    proposals.push(anchor);
    if (weak.distance < 0.1) proposals.push({ kind: "halve", coin: weak.coin, dex: weak.dex, side: weak.side, size: weak.size, mark: weak.markPx });
  } else {
    segments.push({ text: "and every rope has more than 25% of slack. " }, { text: "No action needed.", tone: "strong" });
  }
  const others = ordered.slice(1, 3).filter((rope) => rope.distance !== null);
  if (others.length > 0) segments.push({ text: ` Next: ${others.map((rope) => `${rope.coin} ${pct(rope.distance ?? 0)}`).join(", ")}.` });
  return { topic: "riskiest", readings, segments: [...segments, ...sampleNote(facts)], proposals, followUps: ["what does funding cost me?", `when ${weak.coin} rope is under 5%, close half`] };
}

function exposure(facts: GuideFacts): GuideReply {
  const rows = facts.exposure.filter((row) => !row.isCash && row.netUsd !== null).sort((a, b) => Math.abs(b.netUsd ?? 0) - Math.abs(a.netUsd ?? 0));
  const cash = facts.exposure.filter((row) => row.isCash).reduce((total, row) => total + (row.netUsd ?? 0), 0);
  const net = rows.reduce((total, row) => total + (row.netUsd ?? 0), 0);
  const worth = facts.netWorth ?? 0;
  const readings: Reading[] = [
    { label: "folded layers", detail: "floor + ridge + summit" },
    { label: "assets", detail: String(rows.length) },
    { label: "reference prices", detail: "HyperCore mainnet" },
  ];
  if (rows.length === 0) {
    return { topic: "exposure", readings, segments: [{ text: "You hold only cash: " }, { text: `${usd(cash)} with no market exposure`, tone: "strong" }, { text: "." }, ...sampleNote(facts)], proposals: [], followUps: ["long ETH 3x with 100 USDC, stop at -4%"] };
  }
  const top = rows[0]!;
  const share = worth > 0 ? Math.abs(top.netUsd ?? 0) / worth : 0;
  const segments: Segment[] = [
    { text: `Folded across all three layers you are ` },
    { text: `net ${net >= 0 ? "long" : "short"} ${usd(Math.abs(net))}`, tone: "strong" },
    { text: worth > 0 ? ` on ${usd(worth)} of range (${(Math.abs(net) / worth).toFixed(2)}× of it), with ${usd(cash)} in cash. ` : `, with ${usd(cash)} in cash. ` },
    { text: "Biggest hill: " },
    { text: `${top.underlying} ${usd(top.netUsd ?? 0)}`, tone: (top.netUsd ?? 0) >= 0 ? "up" : "down" },
  ];
  const parts = [top.perp !== 0 ? "perps" : null, top.spot !== 0 ? "spot" : null, top.lst !== 0 ? "staked" : null].filter(Boolean);
  if (parts.length > 1) segments.push({ text: `, held as ${parts.join(" + ")}` });
  segments.push({ text: `, ${pct(share)} of the range.` });
  if (share > 0.35) segments.push({ text: " That is concentrated: one move in it moves everything. Drag the shock slider on your portfolio to see which ropes snap." });
  const rest = rows.slice(1, 4);
  if (rest.length > 0) segments.push({ text: ` Then ${rest.map((row) => `${row.underlying} ${usd(row.netUsd ?? 0)}`).join(", ")}.` });
  return { topic: "exposure", readings, segments: [...segments, ...sampleNote(facts)], proposals: [], followUps: ["what's my riskiest rope right now?", "what does funding cost me?"] };
}

function fundingReply(facts: GuideFacts): GuideReply {
  const readings: Reading[] = [
    { label: "funding rates", detail: `${Object.keys(facts.funding).length} markets` },
    { label: "read ropes", detail: String(facts.ropes.length) },
    { label: "funding history", detail: facts.funding24h === null ? "unavailable" : "24 h" },
  ];
  const rows = facts.ropes
    .map((rope) => ({ rope, perHour: fundingPerHour(rope, facts.funding) }))
    .filter((row): row is { rope: GuideRope; perHour: number } => row.perHour !== null)
    .sort((a, b) => a.perHour - b.perHour);
  if (rows.length === 0) {
    return { topic: "funding", readings, segments: [{ text: facts.ropes.length === 0 ? "No ropes out, so funding neither costs nor pays you anything." : "Funding rates have not arrived yet; ask again in a moment." }, ...sampleNote(facts)], proposals: [], followUps: ["alert me if ETH funding goes above 0.01%"] };
  }
  const total = rows.reduce((sum, row) => sum + row.perHour, 0);
  const segments: Segment[] = [
    { text: "At this hour's rates your ropes " },
    { text: total >= 0 ? `earn ${usd(total)}/h` : `cost ${usd(-total)}/h`, tone: total >= 0 ? "up" : "down" },
    { text: ` (about ${usd(Math.abs(total) * 24)} a day). ` },
  ];
  const worst = rows[0]!;
  if (worst.perHour < 0) segments.push({ text: "The dearest is " }, { text: `${ropeName(worst.rope)} at ${usd(-worst.perHour)}/h`, tone: "strong" }, { text: ". " });
  const best = rows[rows.length - 1]!;
  if (best.perHour > 0) segments.push({ text: `${ropeName(best.rope)} is paid ${usd(best.perHour)}/h to stay. ` });
  if (facts.funding24h !== null) segments.push({ text: `Over the last 24 h funding ${facts.funding24h >= 0 ? "paid you" : "cost you"} ${usd(Math.abs(facts.funding24h))}.` });
  const coin = worst.rope.coin;
  return { topic: "funding", readings, segments: [...segments, ...sampleNote(facts)], proposals: [], followUps: [`alert me if ${coin} funding goes above 0.01%`, "what's my riskiest rope right now?"] };
}

function summary(facts: GuideFacts): GuideReply {
  const readings: Reading[] = [
    { label: "net worth", detail: facts.netWorth === null ? "—" : usd(facts.netWorth) },
    { label: "read ropes", detail: String(facts.ropes.length) },
    { label: "history", detail: facts.fills24h === null ? "unavailable" : "24 h" },
  ];
  const segments: Segment[] = [];
  if (facts.netWorth !== null && facts.byLayer) {
    segments.push({ text: "Your range stands at " }, { text: usd(facts.netWorth), tone: "strong" }, { text: `: Floor ${usd(facts.byLayer.floor)}, Ridge ${usd(facts.byLayer.ridge)}, Summit ${usd(facts.byLayer.summit)}. ` });
  }
  if (facts.realized24h !== null && facts.fills24h !== null) segments.push({ text: `${facts.fills24h} fill${facts.fills24h === 1 ? "" : "s"} in the last 24 h, ${usd(facts.realized24h, true)} realised. ` });
  const weak = ropesByRisk(facts.ropes)[0];
  if (weak && weak.distance !== null) segments.push({ text: "Weakest rope: " }, { text: `${ropeName(weak)} ${pct(weak.distance, 1)}`, tone: weak.distance < 0.1 ? "down" : "strong" }, { text: "." });
  if (segments.length === 0) segments.push({ text: "I have no range to read yet." });
  return { topic: "summary", readings, segments: [...segments, ...sampleNote(facts)], proposals: [], followUps: ["what's my riskiest rope right now?", "how exposed am I?"] };
}

function ruleReply(question: string, facts: GuideFacts): GuideReply {
  const parsed = parseRuleSentence(question)!;
  const standing = Boolean(parsed.rule.action);
  const condition = ruleCondition({ ...parsed.rule, id: "draft", createdAt: 0, lastFiredAt: null, armed: false, once: false, channels: { app: true, telegram: false } });
  return {
    topic: "rule",
    readings: [
      { label: "parsed", detail: parsed.understood },
      { label: "watch", detail: "this tab" },
      { label: "your Rule Book", detail: facts.ruleBook },
    ],
    segments: standing
      ? [
          { text: "A standing order: " },
          { text: `when ${condition}, I draft “${parsed.rule.action}”`, tone: "strong" },
          { text: " and radio you to sign it. I never sign it myself; with a keeper licence that could run while you sleep, once the keeper is online." },
        ]
      : [{ text: "An alert: " }, { text: `I tell you when ${condition}`, tone: "strong" }, { text: ", in the feed here and on Telegram once it is linked." }],
    proposals: [{ kind: "rule", parsed, sentence: question.trim() }],
    followUps: ["what's my riskiest rope right now?"],
  };
}

function help(facts: GuideFacts): GuideReply {
  return {
    topic: "help",
    readings: [{ label: "read ropes", detail: String(facts.ropes.length) }],
    segments: [
      { text: "I read your range and draft moves; " },
      { text: "you sign every one", tone: "strong" },
      { text: ". Ask me about your riskiest rope, your exposure or what funding costs you; give me a route (“bridge 20 HYPE to Elysium”) and I draw the route card; or tell me when to wake you (“alert me if BTC drops below 90k”)." },
    ],
    proposals: [],
    followUps: STARTERS.slice(0, 3),
  };
}

/**
 * A standing order fired: the Guide drafts its action for the coin it is
 * about ("close half" of the rope that crossed the line), never signs it.
 */
export function standingReply(input: { readonly event: string; readonly action: string; readonly coin: string | null }, facts: GuideFacts): GuideReply {
  const action = input.action.trim();
  const lower = action.toLowerCase();
  const rope = input.coin ? facts.ropes.find((entry) => entry.coin === input.coin) : undefined;
  const proposals: Proposal[] = [];
  if (rope && /\b(half|halve)\b/u.test(lower)) proposals.push({ kind: "halve", coin: rope.coin, dex: rope.dex, side: rope.side, size: rope.size, mark: rope.markPx, fraction: 0.5 });
  else if (rope && /\b(close|flatten|exit)\b/u.test(lower)) proposals.push({ kind: "halve", coin: rope.coin, dex: rope.dex, side: rope.side, size: rope.size, mark: rope.markPx, fraction: 1 });
  else if (rope && /\b(anchor|stop)\b/u.test(lower)) proposals.push(anchorProposal(rope));
  else proposals.push({ kind: "route", sentence: input.coin && !lower.includes(input.coin.toLowerCase()) ? `${action} ${input.coin}` : action });
  return {
    topic: "standing",
    readings: [
      { label: "standing order", detail: "fired" },
      { label: "your Rule Book", detail: facts.ruleBook },
    ],
    segments: [{ text: "Your standing order fired: " }, { text: input.event, tone: "strong" }, { text: `. I drafted “${action}”${rope ? ` for ${rope.coin}` : ""}; it waits for your signature.` }],
    proposals,
    followUps: ["what's my riskiest rope right now?"],
  };
}
