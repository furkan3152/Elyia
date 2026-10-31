/**
 * A compact, stable text form of a reading, for the eval corpus and logs:
 * "swap 10 HYPE>USDC @elysium via:kalos-v3", "open long ETH perp margin:200 x5 cross".
 */
import type { AmountSel, AssetSel, Condition, GoalItem, LanguageGoal, MarketSel, Place, PriceSel, SizeSel, TradeGoal, Trigger, ValueGoal } from "@elyia/core";

function fam(network: string | undefined): string {
  if (!network) return "?";
  return network.replace(/-(?:testnet|mainnet)$/u, "");
}

function place(value: Place | undefined): string {
  if (!value) return "?";
  const custody = value.custody;
  if (custody.kind === "hypercore") return custody.class === "unknown" ? "hypercore" : `hypercore:${custody.class}`;
  if (custody.kind === "venue") return `${fam(value.network)}:${custody.protocol ?? "venue"}`;
  if (custody.kind === "loan") return `${fam(value.network)}:loan`;
  return fam(value.network);
}

function amount(value: AmountSel | undefined): string {
  if (!value) return "?";
  switch (value.t) {
    case "exact":
      return value.value;
    case "usd":
      return `$${value.value}`;
    case "portion":
      return `${value.bps / 100}%`;
    case "max":
      return "all";
    case "allBut":
      return `all-${value.keep}`;
    case "previous":
      return "prev";
  }
}

function asset(value: AssetSel | undefined): string {
  if (!value) return "?";
  return "symbol" in value ? value.symbol : `class:${value.class}`;
}

function valueShape(goal: ValueGoal): string {
  const via = goal.constraints.via?.length ? ` via:${goal.constraints.via.join("+")}` : "";
  const chain = goal.chain ? ` <${goal.chain.after}` : "";
  const spend = `${amount(goal.spend.amount)} ${asset(goal.spend.asset)}`;
  switch (goal.kind) {
    case "convert":
      return `${goal.op ?? "swap"} ${spend}>${asset(goal.want.asset)} @${fam(goal.spend.from?.network)}${via}${chain}`;
    case "relocate":
      return `${goal.op ?? "move"} ${spend} ${place(goal.spend.from)}>${place(goal.want.at)}${via}${chain}`;
    case "deliver": {
      const holder = goal.holder.t === "address" ? goal.holder.value.toLowerCase() : goal.holder.t === "name" ? `name:${goal.holder.value}` : goal.holder.t;
      return `send ${spend} @${fam(goal.spend.from?.network)} to:${holder}${chain}`;
    }
    case "stake":
    case "unstake":
      return `${goal.kind} ${spend} @${fam(goal.spend.from?.network)}${via}${chain}`;
    case "borrow":
      return `borrow ${amount(goal.want.amount)} ${asset(goal.want.asset)}${via}`;
    default:
      return `${goal.op ?? goal.kind} ${spend} ${place(goal.spend.from)}>${place(goal.want.at)}${via}`;
  }
}

function market(value: MarketSel | { all: true }): string {
  if ("all" in value) return "all";
  return `${value.dex ? `${value.dex}:` : ""}${value.coin} ${value.kind}`;
}

function size(value: SizeSel | undefined): string {
  if (!value) return "";
  switch (value.t) {
    case "base":
      return ` base:${value.value}`;
    case "notional":
      return ` notional:${value.usd}`;
    case "margin":
      return ` margin:${value.usd}`;
    case "portion":
      return ` portion:${value.bps}${value.of === "position" ? "" : `/${value.of}`}`;
    case "max":
      return " max";
  }
}

function px(value: PriceSel): string {
  switch (value.t) {
    case "market":
      return "mkt";
    case "limit":
      return value.px;
    case "offset":
      return `${value.dir === "below" ? "-" : "+"}${value.pct}%${value.from}`;
    case "breakeven":
      return "be";
  }
}

function trigger(value: Trigger | undefined): string {
  return value ? ` ${value.kind}:${px(value.px)}` : "";
}

function tradeShape(goal: TradeGoal): string {
  const parts = [goal.kind, ...(goal.side ? [goal.side] : []), market(goal.market)].join(" ");
  const lev = goal.leverage ? ` x${goal.leverage.x} ${goal.leverage.mode ?? "cross"}` : "";
  const price = goal.price ? ` limit:${px(goal.price)}` : "";
  const twap = goal.twap ? ` ${goal.twap.minutes}m${goal.twap.randomize ? " random" : ""}` : "";
  const flags = `${goal.tif ? ` ${goal.tif}` : ""}${goal.reduceOnly ? " ro" : ""}${goal.maxSlippageBps !== undefined ? ` slip:${goal.maxSlippageBps}` : ""}`;
  return `${parts}${size(goal.size)}${lev}${price}${twap}${trigger(goal.tp)}${trigger(goal.sl)}${flags}`;
}

function item(value: GoalItem): string {
  if (value.t === "value") return valueShape(value.goal);
  if (value.t === "trade") return tradeShape(value.goal);
  return `alert ${value.goal.channel} ${value.goal.repeat}`;
}

function condition(value: Condition): string {
  const subject = "position" in value.subject ? `position:${market(value.subject.position)}` : "coin" in value.subject ? market(value.subject) : asset(value.subject);
  return `${value.metric} ${subject} ${value.op} ${value.value}${value.unit === "pct" ? "%" : ""}${value.period ? `/${value.period}` : ""}`;
}

export function shapeOf(goal: LanguageGoal): string {
  if (goal.t === "value") return valueShape(goal.goal);
  if (goal.t === "trade") return tradeShape(goal.goal);
  if (goal.t === "query") {
    const subject = goal.goal.subject;
    const text = subject ? ("address" in subject ? subject.address.toLowerCase() : "coin" in subject ? market(subject) : asset(subject)) : "";
    return `query ${goal.goal.what}${text ? ` ${text}` : ""}`;
  }
  const rule = goal.rule;
  const when = rule.when;
  const head = "t" in when ? `every:${when.seconds}${when.at ? `@${when.at.hour}:${String(when.at.minute).padStart(2, "0")}${when.at.tz}` : ""}${when.weekdays ? `/d${when.weekdays.join("")}` : ""}` : "all" in when ? when.all.map(condition).join(" & ") : condition(when);
  const limits = rule.limits;
  const tail = `${limits.maxRuns !== undefined ? ` runs:${limits.maxRuns}` : ""}${limits.expiresAt ? ` until:${limits.expiresAt.slice(0, 10)}` : ""}${limits.maxUsdPerRun ? ` cap:${limits.maxUsdPerRun}` : ""} ${rule.execution}`;
  return `rule ${head} {${rule.then.map(item).join("; ")}}${tail}`;
}
