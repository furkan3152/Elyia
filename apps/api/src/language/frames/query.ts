/**
 * Read-only questions: prices, funding, PnL, positions, orders, balances,
 * liquidation prices, yields, open interest, whales and "is 0x… safe?".
 * Answered from market and portfolio data; never planned.
 */
import type { LanguageGoal, QueryGoal, QueryKind } from "@elyia/core";
import { t } from "../clarify.js";
import { marketsFor } from "../entities.js";
import type { Bag, FrameCtx } from "./common.js";
import type { FrameResult } from "./value.js";

const BY_METRIC: Readonly<Record<string, QueryKind>> = Object.freeze({
  price: "price", mark: "price", oracle: "price", funding: "funding", openInterest: "openInterest", pnl: "pnl", roe: "pnl", liqDistance: "liqPrice", healthFactor: "safety", apy: "apy", balance: "balance",
});

export function readQueryClause(bag: Bag, ctx: FrameCtx): FrameResult {
  let what: QueryKind | undefined;
  for (const hit of bag.all("query")) {
    bag.use(hit.index);
    if (hit.tok.what && !what) what = hit.tok.what;
  }
  const metric = bag.take("metric");
  if (!what && metric) what = BY_METRIC[metric.metric];
  const scope = bag.take("scope");
  if (!what && scope) what = scope.what === "orders" ? "orders" : "positions";
  if (scope && what === "pnl") bag.use(bag.toks.indexOf(scope));
  const levword = bag.take("levword");
  if (!what && levword) what = "leverage";
  bag.take("verb", (tok) => tok.verb === "show" || tok.verb === "alert");
  bag.take("cmp", (tok) => tok.op === "=");
  bag.take("punct");
  bag.take("side");
  const addr = bag.take("addr");
  const name = addr ? null : bag.take("name");
  const market = bag.take("market");
  const asset = market ? null : bag.take("asset");
  bag.take("network");
  bag.take("flag", (tok) => tok.flag === "perpword" || tok.flag === "spotword");
  bag.take("period");
  let subject: QueryGoal["subject"] | undefined;
  if (addr) subject = { address: addr.value };
  else if (market) subject = { coin: market.coin, kind: market.kind ?? "perp", ...(market.dex ? { dex: market.dex } : {}) };
  else if (asset) {
    const facts = marketsFor(ctx.facts.markets, asset.symbol);
    const tradesOn = what === "price" || what === "funding" || what === "openInterest" || what === "liqPrice" || what === "leverage" || what === undefined;
    const perp = facts.find((fact) => fact.kind === "perp" && !fact.dex);
    const spot = facts.find((fact) => fact.kind === "spot");
    if (tradesOn && (what === "funding" || what === "openInterest" || what === "liqPrice" || what === "leverage") && perp) subject = { coin: perp.coin, kind: "perp" };
    else if (tradesOn && perp) subject = { coin: perp.coin, kind: "perp" };
    else if (tradesOn && spot) subject = { coin: spot.coin, kind: "spot" };
    else subject = { symbol: asset.symbol };
  }
  if (name) return { unreadable: t("Ask about an address (0x…); names are resolved when you send.", "Bir adres (0x…) sorun; adlar gönderimde çözülür.") };
  if (!what) what = subject && "address" in subject ? "safety" : subject ? "price" : undefined;
  if (what === "balance" && subject && "coin" in subject) subject = { symbol: subject.coin };
  if (!what) return { unreadable: t("Ask about a price, funding, your PnL, positions, orders or balances.", "Fiyat, fonlama, kâr/zarar, pozisyonlar, emirler veya bakiyeler hakkında sorun.") };
  if ((what === "price" || what === "funding" || what === "openInterest") && !subject) {
    return { unreadable: t("Which market?", "Hangi piyasa?") };
  }
  const goal: QueryGoal = { what, ...(subject ? { subject } : {}) };
  return { goal: { t: "query", goal } satisfies LanguageGoal };
}
