/**
 * The reading as one English sentence in Elyia's own grammar. Every slot the
 * reader filled (network, venue, margin mode, cap) is written out, so the
 * sentence reads back to exactly the same goals (tested as a round trip).
 */
import type { AmountSel, AssetSel, Condition, GoalItem, LanguageGoal, MarketSel, Place, PriceSel, QueryGoal, Rule, SizeSel, TradeGoal, Trigger, ValueGoal } from "@elyia/core";
import { venueById } from "./venues.js";

function family(network: string | undefined): string | undefined {
  if (!network) return undefined;
  return network.startsWith("elysium") ? "elysium" : network.startsWith("hyperevm") ? "hyperevm" : "hypercore";
}

function asset(selection: AssetSel | undefined): string {
  if (!selection) return "?";
  return "symbol" in selection ? selection.symbol : "stables";
}

function amount(selection: AmountSel | undefined, symbol: string): string {
  if (!selection) return symbol;
  switch (selection.t) {
    case "exact":
      return `${selection.value} ${symbol}`;
    case "usd":
      return `$${selection.value} of ${symbol}`;
    case "portion":
      return `${trimBps(selection.bps)}% of ${symbol}`;
    case "max":
      return `all ${symbol}`;
    case "allBut":
      return `all ${symbol}`;
    case "previous":
      return symbol;
  }
}

function trimBps(bps: number): string {
  return String(bps / 100);
}

function place(selection: Place | undefined): string {
  if (!selection) return "?";
  const custody = selection.custody;
  if (custody.kind === "hypercore") return custody.class === "unknown" ? "hypercore" : custody.class === "perp" ? "hypercore perps" : "hypercore spot";
  return family(selection.network) ?? "?";
}

function venueWord(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const venue = venueById(id);
  return venue?.words[0];
}

function valueSentence(goal: ValueGoal): string {
  const spend = asset(goal.spend.asset);
  const via = venueWord(goal.constraints.via?.[0]);
  switch (goal.kind) {
    case "convert": {
      const verb = goal.op === "wrap" ? "wrap" : goal.op === "unwrap" ? "unwrap" : "swap";
      const target = verb === "swap" ? ` to ${asset(goal.want.asset)}` : "";
      return `${verb} ${amount(goal.spend.amount, spend)}${target}${via ? ` on ${via}` : ""} on ${family(goal.spend.from?.network) ?? "?"}`;
    }
    case "relocate": {
      const verb = goal.op === "bridge" || goal.op === "deposit" || goal.op === "withdraw" ? goal.op : "move";
      return `${verb} ${amount(goal.spend.amount, spend)} from ${place(goal.spend.from)} to ${place(goal.want.at)}${via ? ` via ${via}` : ""}`;
    }
    case "deliver": {
      const holder = goal.holder.t === "address" || goal.holder.t === "name" ? goal.holder.value : "?";
      return `send ${amount(goal.spend.amount, spend)} to ${holder} on ${family(goal.spend.from?.network) ?? "?"}`;
    }
    case "stake":
      return `stake ${amount(goal.spend.amount, spend)} with ${via ?? "?"}`;
    case "unstake":
      return `unstake ${amount(goal.spend.amount, spend)} with ${via ?? "?"}`;
    case "earn":
      return `lend ${amount(goal.spend.amount, spend)} on ${via ?? "?"}`;
    case "exit":
      return `withdraw ${amount(goal.spend.amount, spend)} from ${via ?? "?"}`;
    case "borrow":
      return `borrow ${amount(goal.want.amount, asset(goal.want.asset))} on ${via ?? "?"}`;
    case "repay":
      return `repay ${amount(goal.spend.amount, spend)} on ${via ?? "?"}`;
    default:
      return `${goal.kind} ${spend}`;
  }
}

function coin(market: MarketSel | { all: true }): string {
  if ("all" in market) return "all";
  return market.dex ? `${market.dex}:${market.coin}` : market.coin;
}

function size(selection: SizeSel | undefined, name: string): string {
  if (!selection) return name;
  switch (selection.t) {
    case "base":
      return `${selection.value} ${name}`;
    case "notional":
      return `$${selection.usd} of ${name}`;
    case "margin":
      return `${name} with $${selection.usd} margin`;
    case "portion":
      return `${name} with ${trimBps(selection.bps)}% of my account`;
    case "max":
      return `all ${name}`;
  }
}

function price(selection: PriceSel | undefined): string {
  if (!selection || selection.t === "market") return "";
  if (selection.t === "limit") return ` limit ${selection.px}`;
  return "";
}

function trigger(selection: Trigger | undefined): string {
  if (!selection) return "";
  const word = selection.kind === "tp" ? "tp" : "sl";
  const px = selection.px;
  if (px.t === "limit") return ` ${word} ${px.px}`;
  if (px.t === "breakeven") return ` ${word} breakeven`;
  if (px.t === "offset") return ` ${word} ${px.pct}% ${px.dir} entry`;
  return "";
}

function tradeSentence(goal: TradeGoal): string {
  const name = coin(goal.market);
  const kindWord = "coin" in goal.market && goal.market.kind === "spot" ? " spot" : "";
  const leverage = goal.leverage ? ` ${goal.leverage.x}x ${goal.leverage.mode ?? "cross"}` : "";
  const extras = `${price(goal.price)}${goal.tif ? ` ${goal.tif}` : ""}${goal.reduceOnly ? " reduce only" : ""}${trigger(goal.tp)}${trigger(goal.sl)}${goal.maxSlippageBps !== undefined ? ` slippage ${goal.maxSlippageBps / 100}%` : ""}`;
  switch (goal.kind) {
    case "open":
    case "order":
      return `${goal.side ?? "?"} ${size(goal.size, name)}${kindWord}${leverage}${extras}`;
    case "close":
      return "all" in goal.market ? `close all positions${price(goal.price)}` : `close ${name}${goal.side ? ` ${goal.side}` : ""}${price(goal.price)}`;
    case "reduce":
      return `reduce ${name}${goal.side ? ` ${goal.side}` : ""} by ${goal.size?.t === "portion" ? trimBps(goal.size.bps) : "?"}%${price(goal.price)}`;
    case "cancel":
      return "all" in goal.market ? "cancel all orders" : `cancel ${name}${kindWord} orders`;
    case "twap":
      return `twap ${goal.side ?? "?"} ${size(goal.size, name)}${kindWord}${leverage} over ${goal.twap?.minutes ?? "?"}m${goal.twap?.randomize ? " randomized" : ""}${goal.reduceOnly ? " reduce only" : ""}`;
    case "setLeverage":
      return `set ${name} leverage to ${goal.leverage?.x ?? "?"}x ${goal.leverage?.mode ?? "cross"}`;
    case "protect":
      return `set${trigger(goal.tp)}${trigger(goal.sl)} on ${"all" in goal.market ? "all positions" : name}${goal.side ? ` ${goal.side}` : ""}`;
  }
}

function itemSentence(item: GoalItem): string {
  if (item.t === "value") return valueSentence(item.goal);
  if (item.t === "trade") return tradeSentence(item.goal);
  return `alert me${item.goal.channel === "telegram" ? " on telegram" : " in the app"}`;
}

const OP_WORDS: Readonly<Record<Condition["op"], string>> = Object.freeze({ "<": "below", "<=": "<=", ">": "above", ">=": ">=", crossesAbove: "crosses above", crossesBelow: "crosses below" });
const METRIC_WORDS: Readonly<Record<Condition["metric"], string>> = Object.freeze({
  price: "price", mark: "mark price", oracle: "oracle price", funding: "funding", openInterest: "open interest", pnl: "pnl", roe: "pnl", liqDistance: "liq distance", healthFactor: "health factor", apy: "apy", balance: "balance",
});
const PERIOD_WORDS: Readonly<Record<NonNullable<Condition["period"]>, string>> = Object.freeze({ "1h": " per hour", "8h": " per 8h", apr: " apr" });

function subject(condition: Condition): string {
  const value = condition.subject;
  if ("position" in value) return `my ${coin(value.position)} position`;
  if ("coin" in value) return coin(value);
  return "symbol" in value ? value.symbol : "stables";
}

function conditionSentence(condition: Condition): string {
  const level = condition.unit === "pct" ? `${condition.value}%` : condition.value;
  return `${subject(condition)} ${METRIC_WORDS[condition.metric]} ${OP_WORDS[condition.op]} ${level}${condition.period ? PERIOD_WORDS[condition.period] : ""}`;
}

function every(seconds: number, weekdays?: readonly number[]): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  if (weekdays && weekdays.length === 1) return `every ${days[weekdays[0] as number]}`;
  if (seconds === 86_400) return "every day";
  if (seconds === 3_600) return "every hour";
  if (seconds === 604_800) return "every week";
  if (seconds % 86_400 === 0) return `every ${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return `every ${seconds / 3_600} hours`;
  return `every ${Math.round(seconds / 60)} minutes`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function ruleSentence(rule: Rule): string {
  const body = rule.then.map(itemSentence).join(", then ");
  const limits: string[] = [];
  const when = rule.when;
  let head: string;
  if ("t" in when) {
    head = `${every(when.seconds, when.weekdays)}${when.at ? ` at ${pad(when.at.hour)}:${pad(when.at.minute)}${when.at.tz === "UTC" ? " utc" : ""}` : ""}`;
  } else {
    const conditions = "all" in when ? when.all : [when];
    const repeat = rule.limits.maxRuns === undefined || rule.limits.maxRuns > 1 || rule.then.some((item) => item.t === "alert" && item.goal.repeat === "always");
    head = `${repeat ? "whenever" : "when"} ${conditions.map(conditionSentence).join(" and ")}`;
  }
  const scheduled = "t" in when;
  if (rule.limits.maxRuns !== undefined && (scheduled || rule.limits.maxRuns !== 1)) limits.push(`${rule.limits.maxRuns} times`);
  if (rule.limits.expiresAt) limits.push(`until ${rule.limits.expiresAt.slice(0, 10)}`);
  if (rule.limits.maxUsdPerRun) limits.push(`cap $${rule.limits.maxUsdPerRun}`);
  return `${head}, ${body}${limits.length > 0 ? `, ${limits.join(", ")}` : ""}`;
}

const QUERY_WORDS: Readonly<Record<QueryGoal["what"], string>> = Object.freeze({
  balance: "balance", positions: "positions", pnl: "pnl", price: "price", funding: "funding", orders: "orders", liqPrice: "liq price", apy: "apy", portfolio: "portfolio", safety: "safe", whales: "whales", openInterest: "open interest", leverage: "leverage",
});

function querySentence(goal: QueryGoal): string {
  const target = goal.subject ? ("address" in goal.subject ? goal.subject.address : "coin" in goal.subject ? coin(goal.subject) : "symbol" in goal.subject ? goal.subject.symbol : "stables") : "";
  if (goal.what === "safety") return `is ${target} safe?`;
  if (goal.what === "positions" || goal.what === "orders" || goal.what === "portfolio" || goal.what === "pnl" || goal.what === "whales") return `show my ${QUERY_WORDS[goal.what]}${target ? ` ${target}` : ""}`;
  return `what is the ${target ? `${target} ` : ""}${QUERY_WORDS[goal.what]}?`;
}

export function canonicalSentence(goals: readonly LanguageGoal[]): string {
  const parts = goals.map((goal) => {
    if (goal.t === "value") return valueSentence(goal.goal);
    if (goal.t === "trade") return tradeSentence(goal.goal);
    if (goal.t === "rule") return ruleSentence(goal.rule);
    return querySentence(goal.goal);
  });
  return parts.join(", then ");
}
