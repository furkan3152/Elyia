/**
 * Portfolio insights: deterministic, explainable, reproducible from the
 * snapshot (and, where named, the history and mainnet funding). Each insight
 * carries the numbers it used and draft intent actions; the user turns one
 * into a proposal and signs it. Nothing here calls a model.
 *
 *   rebalance          drift from the target mix -> one route card
 *   auto-protect       perp positions without a stop -> native reduce-only stop (inside half the liquidation distance)
 *   liquidation-guard  positions within 5 % of liquidation -> reduce 25 %
 *   funding-harvest    highest mainnet funding carry (paper on testnet)
 *   idle-cash          idle USDC on Elysium -> verified vault (yield not measured: said so)
 *   what-if            shocks of -30..+10 % per underlying: PnL, liquidations
 *   gas-top-up         HYPE below the gas floor on Elysium / HyperEVM -> bridge / link from another layer
 *   dust-sweep         priced Elysium holdings below the dust threshold -> swap to HYPE
 *   explain-pnl        realized, fees, funding and unrealized over the history window
 */
import { elysiumNetworkFor, hypercoreNetworkFor } from "../../config.js";
import type { AgentMemory, Insight, ShockScenario } from "@elyia/core/api/agent";
import type { IntentActionSpec, NetworkEnvironment } from "@elyia/core";
import type { BalanceLine, PerpPositionView, PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";

export interface FundingCandidate {
  readonly coin: string;
  readonly aprPct: number;
  readonly openInterestUsd: number | null;
  readonly markPx: number | null;
}

export interface InsightInput {
  readonly snapshot: PortfolioSnapshot;
  readonly memory: AgentMemory;
  /** Coins with an open stop (sl) / take-profit (tp) trigger order. */
  readonly triggers: ReadonlyMap<string, { readonly sl: boolean; readonly tp: boolean }>;
  readonly history: PortfolioHistory | null;
  /** HyperCore mainnet funding (the signal, on testnet too). */
  readonly funding: readonly FundingCandidate[] | null;
  readonly environment: NetworkEnvironment;
}

export const SHOCK_MOVES = Object.freeze([-30, -20, -10, 10] as const);
const STOP_DISTANCE_PCT: Readonly<Record<AgentMemory["riskProfile"], number>> = Object.freeze({ careful: 5, balanced: 8, bold: 12 });

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** HyperCore prices: at most 5 significant figures. */
export function priceText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const digits = Math.max(0, 5 - Math.floor(Math.log10(value)) - 1);
  return value.toFixed(Math.min(digits, 6)).replace(/\.?0+$/u, "");
}

function usd(value: number): string {
  return `$${round(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function lines(snapshot: PortfolioSnapshot): BalanceLine[] {
  return snapshot.layers.flatMap((layer) => layer.lines);
}

function walletAmount(snapshot: PortfolioSnapshot, layer: BalanceLine["layer"], asset: string): number {
  return lines(snapshot)
    .filter((line) => line.layer === layer && line.account === (layer === "hypercore" ? "spot" : "wallet") && line.asset.toUpperCase() === asset.toUpperCase())
    .reduce((sum, line) => sum + Number(line.amount), 0);
}

function id(kind: Insight["kind"], key: string): string {
  return `ins_${kind}_${key}`.replace(/[^A-Za-z0-9_:-]/gu, "_").slice(0, 80);
}

/* ------------------------------------------------------------- shocks */

export function shocks(snapshot: PortfolioSnapshot): ShockScenario[] {
  const out: ShockScenario[] = [];
  const directional = snapshot.exposure.filter((row) => !row.isCash && row.priceUsd !== null && row.net !== 0).slice(0, 4);
  for (const row of directional) {
    for (const move of SHOCK_MOVES) {
      const price = row.priceUsd as number;
      const pnlUsd = row.net * price * (move / 100);
      const liquidated = snapshot.positions
        .filter((position) => position.coin.replace(/^.*:/u, "") === row.underlying && position.liquidationPx !== null)
        .filter((position) => {
          const after = position.markPx * (1 + move / 100);
          const liq = Number(position.liquidationPx);
          return position.side === "long" ? after <= liq : after >= liq;
        })
        .map((position) => position.coin);
      out.push({ underlying: row.underlying, movePct: move, pnlUsd: round(pnlUsd), netWorthAfterUsd: round(snapshot.totals.netWorthUsd + pnlUsd), liquidated });
    }
  }
  return out;
}

/* ------------------------------------------------------------ insights */

function protectInsight(position: PerpPositionView, memory: AgentMemory, network: string): Insight {
  const mark = position.markPx;
  const liq = position.liquidationPx === null ? null : Number(position.liquidationPx);
  const fallback = STOP_DISTANCE_PCT[memory.riskProfile];
  // Inside half the liquidation distance, never wider than the risk profile's stop.
  const halfLiqPct = liq === null ? null : (Math.abs(mark - liq) / mark) * 50;
  const distancePct = halfLiqPct === null ? fallback : Math.min(fallback, halfLiqPct);
  const stop = position.side === "long" ? mark * (1 - distancePct / 100) : mark * (1 + distancePct / 100);
  const lossUsd = Math.abs(Number(position.size)) * Math.abs(mark - stop);
  const stopText = priceText(stop);
  return {
    id: id("auto-protect", position.id),
    kind: "auto-protect",
    severity: position.liquidationRisk === "danger" ? "act" : "watch",
    title: { en: `Protect your ${position.coin} ${position.side}`, tr: `${position.coin} ${position.side === "long" ? "long" : "short"} pozisyonunu koru` },
    explanation: {
      en: `No stop is resting for ${position.coin}. A native reduce-only stop at ${stopText} (${round(distancePct)}% from mark ${priceText(mark)}${liq !== null ? `, inside half the distance to liquidation at ${priceText(liq)}` : ""}) caps the loss near ${usd(lossUsd)}. It lives on HyperCore, so it works even when Elyia is offline.`,
      tr: `${position.coin} için bekleyen stop yok. ${stopText} seviyesinde (${round(distancePct)}%, işaret fiyatı ${priceText(mark)}${liq !== null ? `; ${priceText(liq)} tasfiye mesafesinin yarısının içinde` : ""}) yerel, yalnızca azaltan bir stop zararı yaklaşık ${usd(lossUsd)} ile sınırlar. HyperCore üzerinde durur; Elyia kapalıyken de çalışır.`,
    },
    figures: { coin: position.coin, side: position.side, size: position.size, markPx: mark, liquidationPx: liq, stopPx: stopText, stopDistancePct: round(distancePct), lossAtStopUsd: round(lossUsd) },
    actions: [{ kind: "order", network: network as IntentActionSpec["network"], market: position.coin, stopLoss: stopText, params: { protect: true } }],
    paper: false,
  };
}

export function computeInsights(input: InsightInput): { readonly insights: Insight[]; readonly shocks: ShockScenario[] } {
  const { snapshot, memory, environment } = input;
  const elysium = elysiumNetworkFor(environment);
  const hypercore = hypercoreNetworkFor(environment);
  const hyperevm = environment === "testnet" ? "hyperevm-testnet" : "hyperevm-mainnet";
  const netWorth = snapshot.totals.netWorthUsd;
  const out: Insight[] = [];
  const priceOf = (underlying: string) => snapshot.exposure.find((row) => row.underlying === underlying)?.priceUsd ?? null;
  const hypePrice = priceOf("HYPE");

  // Liquidation guard and auto-protect.
  for (const position of snapshot.positions) {
    if (position.liquidationRisk === "danger") {
      out.push({
        id: id("liquidation-guard", position.id),
        kind: "liquidation-guard",
        severity: "act",
        title: { en: `${position.coin} is close to liquidation`, tr: `${position.coin} tasfiyeye yakın` },
        explanation: {
          en: `Mark ${priceText(position.markPx)} is ${round(position.liquidationDistancePct ?? 0)}% from liquidation at ${position.liquidationPx}. Reducing the position by 25% (reduce-only) moves the liquidation price away and frees margin.`,
          tr: `İşaret fiyatı ${priceText(position.markPx)}, ${position.liquidationPx} tasfiye fiyatına %${round(position.liquidationDistancePct ?? 0)} uzaklıkta. Pozisyonu %25 azaltmak (yalnızca azaltan) tasfiye fiyatını uzaklaştırır ve teminat boşaltır.`,
        },
        figures: { coin: position.coin, liquidationDistancePct: position.liquidationDistancePct, liquidationPx: position.liquidationPx, positionValueUsd: position.positionValueUsd, reduceBps: 2_500 },
        actions: [{ kind: "order", network: hypercore, market: position.coin, params: { reduce: true, portionBps: 2_500 } }],
        paper: false,
      });
    }
    const trigger = input.triggers.get(position.coin);
    if (!trigger?.sl) out.push(protectInsight(position, memory, hypercore));
  }

  // Rebalance to the target mix.
  if (memory.targetMix && netWorth > 0) {
    const current = new Map<string, number>();
    for (const row of snapshot.exposure) {
      const key = row.isCash ? "USD" : row.underlying;
      current.set(key, (current.get(key) ?? 0) + (row.netUsd ?? 0));
    }
    const drifts = Object.entries(memory.targetMix.weights).map(([underlying, target]) => {
      const pct = ((current.get(underlying) ?? 0) / netWorth) * 100;
      return { underlying, target, pct: round(pct), drift: round(pct - target) };
    });
    const over = [...drifts].sort((a, b) => b.drift - a.drift)[0];
    const under = [...drifts].sort((a, b) => a.drift - b.drift)[0];
    if (over && under && over.drift > memory.targetMix.bandPct && under.drift < -memory.targetMix.bandPct) {
      const moveUsd = Math.min(over.drift, -under.drift) * (netWorth / 100);
      const actions: IntentActionSpec[] = [];
      const gasFloor = Number(memory.gasFloorHype);
      if (over.underlying === "HYPE" && under.underlying === "USD" && hypePrice) {
        const available = Math.max(0, walletAmount(snapshot, "elysium", "HYPE") - gasFloor);
        const amount = Math.min(available, moveUsd / hypePrice);
        if (amount > 0) actions.push({ kind: "swap", network: elysium, from: "HYPE", to: "USDC", amount: amount.toFixed(6) });
      } else if (over.underlying === "USD" && under.underlying === "HYPE") {
        const amount = Math.min(walletAmount(snapshot, "elysium", "USDC"), moveUsd);
        if (amount > 0) actions.push({ kind: "swap", network: elysium, from: "USDC", to: "HYPE", amount: amount.toFixed(2) });
      }
      out.push({
        id: id("rebalance", `${over.underlying}-${under.underlying}`),
        kind: "rebalance",
        severity: "watch",
        title: { en: `Rebalance: ${over.underlying} is ${over.drift} pts over target`, tr: `Yeniden dengele: ${over.underlying} hedefin ${over.drift} puan üstünde` },
        explanation: {
          en: `Target ${over.underlying} ${over.target}% / ${under.underlying} ${under.target}%; now ${over.pct}% / ${under.pct}%. Moving about ${usd(moveUsd)} brings both back inside the ±${memory.targetMix.bandPct} pt band.${actions.length === 0 ? " No wallet balance on Elysium can make this move in one card; it needs a HyperCore trade." : ""}`,
          tr: `Hedef ${over.underlying} %${over.target} / ${under.underlying} %${under.target}; şu an %${over.pct} / %${under.pct}. Yaklaşık ${usd(moveUsd)} taşımak ikisini de ±${memory.targetMix.bandPct} puan bandına geri getirir.${actions.length === 0 ? " Elysium cüzdanındaki bakiye bu hareketi tek kartta yapamıyor; HyperCore işlemi gerekir." : ""}`,
        },
        figures: { netWorthUsd: round(netWorth), moveUsd: round(moveUsd), ...Object.fromEntries(drifts.map((entry) => [`${entry.underlying}Pct`, entry.pct])) },
        actions,
        paper: false,
      });
    }
  }

  // Funding harvester (paper on testnet).
  const best = (input.funding ?? []).filter((row) => Math.abs(row.aprPct) >= 10 && (row.openInterestUsd ?? 0) >= 1_000_000).sort((a, b) => Math.abs(b.aprPct) - Math.abs(a.aprPct))[0];
  if (best) {
    const notional = 1_000;
    const dailyUsd = (notional * Math.abs(best.aprPct)) / 100 / 365;
    const legs = best.aprPct > 0 ? "long spot + short perp" : "short spot exposure + long perp";
    out.push({
      id: id("funding-harvest", best.coin),
      kind: "funding-harvest",
      severity: "info",
      title: { en: `${best.coin} funding pays ${round(best.aprPct, 1)}% APR`, tr: `${best.coin} fonlaması yıllık %${round(best.aprPct, 1)} ödüyor` },
      explanation: {
        en: `On HyperCore mainnet, ${best.coin} funding is ${round(best.aprPct, 1)}% APR. A delta-neutral ${legs} of ${usd(notional)} would collect about ${usd(dailyUsd)} a day while funding stays there. Funding flips; this is a carry, not a promise.${environment === "testnet" ? " Paper only on testnet: testnet funding is not the real market." : " Two legs, two signatures."}`,
        tr: `HyperCore ana ağında ${best.coin} fonlaması yıllık %${round(best.aprPct, 1)}. ${usd(notional)} tutarında delta-nötr bir pozisyon, fonlama böyle kaldıkça günde yaklaşık ${usd(dailyUsd)} toplar. Fonlama tersine dönebilir; bu bir getiri vaadi değildir.${environment === "testnet" ? " Testnette yalnızca kağıt üzerinde: testnet fonlaması gerçek piyasa değil." : " İki bacak, iki imza."}`,
      },
      figures: { coin: best.coin, aprPct: round(best.aprPct, 2), notionalUsd: notional, dailyCarryUsd: round(dailyUsd), openInterestUsd: best.openInterestUsd },
      actions: [],
      paper: environment === "testnet",
    });
  }

  // Idle cash sweeper.
  const idleUsdc = walletAmount(snapshot, "elysium", "USDC");
  if (environment === "testnet" && idleUsdc >= 10) {
    const amount = Math.floor(idleUsdc * 0.9 * 100) / 100;
    out.push({
      id: id("idle-cash", "usdc"),
      kind: "idle-cash",
      severity: "info",
      title: { en: `${usd(idleUsdc)} USDC sits idle on Elysium`, tr: `Elysium'da ${usd(idleUsdc)} USDC boşta bekliyor` },
      explanation: {
        en: `The Cheshire USDC vault is the verified ERC-4626 venue for USDC on Elysium. Its yield is not measured by Elyia yet, so no APY is promised. Depositing 90% (${amount} USDC) keeps a 10% buffer.`,
        tr: `Cheshire USDC kasası, Elysium'da USDC için doğrulanmış ERC-4626 alanı. Getirisi Elyia tarafından henüz ölçülmedi; APY vaadi yok. %90'ını (${amount} USDC) yatırmak %10 tampon bırakır.`,
      },
      figures: { idleUsdc: round(idleUsdc), depositUsdc: amount, venue: "cheshire", apyPct: null },
      actions: [{ kind: "deposit", network: elysium, from: "USDC", amount: amount.toFixed(2), protocol: "cheshire" }],
      paper: false,
    });
  }

  // Gas at every camp.
  const floor = Number(memory.gasFloorHype);
  const elysiumHype = walletAmount(snapshot, "elysium", "HYPE");
  const evmHype = walletAmount(snapshot, "hyperevm", "HYPE");
  const coreHype = walletAmount(snapshot, "hypercore", "HYPE");
  const gasActions: IntentActionSpec[] = [];
  const topUp = (floor * 2).toFixed(4);
  if (elysiumHype < floor && evmHype > floor * 3) gasActions.push({ kind: "bridge", network: hyperevm, toNetwork: elysium, from: "HYPE", amount: topUp });
  if (evmHype < floor && coreHype > floor * 3) gasActions.push({ kind: "link", network: hypercore, toNetwork: hyperevm, from: "HYPE", amount: topUp });
  if (elysiumHype < floor || evmHype < floor) {
    out.push({
      id: id("gas-top-up", "hype"),
      kind: "gas-top-up",
      severity: gasActions.length > 0 ? "act" : "watch",
      title: { en: "Gas is low at a camp", tr: "Bir kampta gaz azaldı" },
      explanation: {
        en: `HYPE for gas: Elysium ${round(elysiumHype, 4)}, HyperEVM ${round(evmHype, 4)}, HyperCore spot ${round(coreHype, 4)} (floor ${floor}). ${gasActions.length > 0 ? `Moving ${topUp} HYPE from a layer with spare HYPE keeps every layer usable.` : "No layer has spare HYPE to move; add some from your wallet."}`,
        tr: `Gaz için HYPE: Elysium ${round(elysiumHype, 4)}, HyperEVM ${round(evmHype, 4)}, HyperCore spot ${round(coreHype, 4)} (taban ${floor}). ${gasActions.length > 0 ? `Fazlası olan katmandan ${topUp} HYPE taşımak her katmanı kullanılabilir tutar.` : "Taşınacak fazla HYPE yok; cüzdanından ekle."}`,
      },
      figures: { elysiumHype: round(elysiumHype, 6), hyperevmHype: round(evmHype, 6), hypercoreHype: round(coreHype, 6), floorHype: floor },
      actions: gasActions,
      paper: false,
    });
  }

  // Dust sweep.
  const dust = lines(snapshot).filter((line) => line.layer === "elysium" && line.account === "wallet" && line.usd !== null && line.usd > 0 && line.usd < memory.dustUsd && !["HYPE", "WHYPE"].includes(line.asset.toUpperCase()));
  if (dust.length > 0) {
    const total = dust.reduce((sum, line) => sum + (line.usd ?? 0), 0);
    out.push({
      id: id("dust-sweep", "elysium"),
      kind: "dust-sweep",
      severity: "info",
      title: { en: `${dust.length} dust balances on Elysium`, tr: `Elysium'da ${dust.length} küçük bakiye` },
      explanation: {
        en: `${dust.map((line) => `${line.amount} ${line.asset}`).join(", ")} are worth ${usd(total)} together (reference prices). Sweeping them into HYPE tidies the wallet; gas may cost more than tiny ones are worth.`,
        tr: `${dust.map((line) => `${line.amount} ${line.asset}`).join(", ")} toplamda ${usd(total)} değerinde (referans fiyatlar). HYPE'a süpürmek cüzdanı toparlar; çok küçük olanlarda gaz değerinden fazla olabilir.`,
      },
      figures: { lines: dust.length, totalUsd: round(total) },
      actions: dust.slice(0, 6).map((line) => ({ kind: "swap" as const, network: elysium, from: line.assetId ?? line.asset, to: "HYPE", amount: line.amount })),
      paper: false,
    });
  }

  // What-if shocks.
  const scenarios = shocks(snapshot);
  const worst = [...scenarios].sort((a, b) => a.pnlUsd - b.pnlUsd)[0];
  if (worst && worst.pnlUsd < 0) {
    out.push({
      id: id("what-if", `${worst.underlying}${worst.movePct}`),
      kind: "what-if",
      severity: worst.liquidated.length > 0 ? "act" : "info",
      title: { en: `If ${worst.underlying} moves ${worst.movePct}%`, tr: `${worst.underlying} %${worst.movePct} hareket ederse` },
      explanation: {
        en: `Net worth goes from ${usd(netWorth)} to ${usd(worst.netWorthAfterUsd)} (${usd(worst.pnlUsd)}).${worst.liquidated.length > 0 ? ` Liquidated: ${worst.liquidated.join(", ")}.` : " No position would be liquidated."}`,
        tr: `Net değer ${usd(netWorth)} seviyesinden ${usd(worst.netWorthAfterUsd)} seviyesine iner (${usd(worst.pnlUsd)}).${worst.liquidated.length > 0 ? ` Tasfiye olur: ${worst.liquidated.join(", ")}.` : " Hiçbir pozisyon tasfiye olmaz."}`,
      },
      figures: { underlying: worst.underlying, movePct: worst.movePct, pnlUsd: worst.pnlUsd, netWorthAfterUsd: worst.netWorthAfterUsd },
      actions: [],
      paper: false,
    });
  }

  // Explain my PnL.
  if (input.history) {
    const totals = input.history.totals;
    const unrealized = snapshot.totals.unrealizedPnlUsd;
    const days = Math.max(1, Math.round((input.history.to - input.history.from) / 86_400_000));
    const best = [...input.history.calendar].sort((a, b) => b.net - a.net)[0];
    const worstDay = [...input.history.calendar].sort((a, b) => a.net - b.net)[0];
    out.push({
      id: id("explain-pnl", String(days)),
      kind: "explain-pnl",
      severity: "info",
      title: { en: `Your PnL over ${days} days`, tr: `${days} günlük kâr/zararın` },
      explanation: {
        en: `Realized ${usd(totals.realizedPnl)}, fees ${totals.fees >= 0 ? `${usd(totals.fees)} paid` : `${usd(-totals.fees)} rebated`}, funding ${usd(totals.funding)}: net ${usd(totals.net)} on ${usd(totals.volume)} traded. Open positions add ${usd(unrealized)} unrealized.${best ? ` Best day ${best.day} (${usd(best.net)})` : ""}${worstDay ? `, worst ${worstDay.day} (${usd(worstDay.net)}).` : "."}${totals.fees > Math.abs(totals.realizedPnl) && totals.fees > 0 ? " Fees cost more than trading made: fewer, larger trades or maker orders would help." : ""}`,
        tr: `Gerçekleşen ${usd(totals.realizedPnl)}, ücretler ${totals.fees >= 0 ? `${usd(totals.fees)} ödendi` : `${usd(-totals.fees)} iade`}, fonlama ${usd(totals.funding)}: ${usd(totals.volume)} hacimde net ${usd(totals.net)}. Açık pozisyonlar ${usd(unrealized)} gerçekleşmemiş ekliyor.${best ? ` En iyi gün ${best.day} (${usd(best.net)})` : ""}${worstDay ? `, en kötü ${worstDay.day} (${usd(worstDay.net)}).` : "."}`,
      },
      figures: { realizedPnlUsd: round(totals.realizedPnl), feesUsd: round(totals.fees), fundingUsd: round(totals.funding), netUsd: round(totals.net), volumeUsd: round(totals.volume), unrealizedPnlUsd: round(unrealized), days },
      actions: [],
      paper: false,
    });
  }

  const order: Record<Insight["severity"], number> = { act: 0, watch: 1, info: 2 };
  return { insights: out.sort((a, b) => order[a.severity] - order[b.severity]), shocks: scenarios };
}
