import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { Page } from "../../app/shell/Page";
import { useUiStore } from "../../app/state/uiStore";
import { infoClient } from "../../lib/hypercore/runtime";
import { Reveal } from "../../motion/Reveal";
import { Signpost } from "../../topo/Signpost";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FlowCard } from "../track/flow/FlowCard";
import { useDebounced, useFlowPlan, type FlowAsk, type FlowPlan } from "../track/flow/useFlowPlan";
import { useFlowRun } from "../track/flow/useFlowRun";
import { packFigure, usePacks } from "../track/flow/usePacks";
import { PriceAltitude } from "./PriceAltitude";
import { impliedHypePrice, SLIPPAGE_CHOICES, swapAction, swapSentence, VENUES, type AltitudeMark, type SlippageBps, type SwapLayer, type SwapToken } from "./swapModel";

const LAYER_LABEL: Readonly<Record<SwapLayer, string>> = { summit: "Summit · Elysium", ridge: "Ridge · HyperEVM", floor: "Floor · HyperCore" };
/** HYPE/USDC spot book coin per mode (spotMeta). */
const HYPE_BOOK: Readonly<Record<NetworkEnvironment, string>> = { testnet: "@1035", mainnet: "@107" };

function swapAsk(layer: SwapLayer, from: SwapToken, amount: string, venue: string | null, slippage: SlippageBps, mode: NetworkEnvironment, probe = false): FlowAsk | null {
  if (layer === "floor" || !/^\d*\.?\d+$/u.test(amount) || Number(amount) <= 0) return null;
  return {
    key: `${probe ? "probe:" : ""}${layer}:${from}:${amount}:${venue ?? "best"}:${slippage}`,
    sentence: swapSentence(layer, from, amount, venue),
    grade: 1,
    actions: [swapAction({ layer, from, amount, venue, mode })],
    constraints: { maxSlippageBps: slippage },
  };
}

/** Implied HYPE price of every venue that quoted a 1-HYPE probe. */
function probeMarks(plan: FlowPlan | undefined): AltitudeMark[] {
  if (!plan || plan.kind !== "planner") return [];
  return plan.response.quotes.flatMap((quote) => {
    const out = Number(quote.expected) / 10 ** quote.decimals;
    const price = impliedHypePrice("HYPE", 1, out);
    const venue = Object.values(VENUES).flat().find((item) => item.id === quote.protocol);
    return price ? [{ id: quote.protocol, label: venue?.label ?? quote.protocol, price, kind: "pool" as const, detail: "test-USDC pool" }] : [];
  });
}

/**
 * "/app/swap": swap at the hut. The ticket (pay, receive, venue, slippage)
 * for the Summit's two pools and the Ridge's HyperSwap; the Floor trades on
 * the book in the terminal. Beside it the price altitude reads one HYPE
 * against the HyperCore mainnet reference, so a practice-wall price is never
 * mistaken for a market price. Every swap ends in a route card whose
 * minimum out is written into the transaction.
 */
export default function SwapPage() {
  const mode = useUiStore((state) => state.mode);
  const { address } = useAccount();
  const packs = usePacks(address);
  const initialLayer = useSearchParam("layer");
  const [layer, setLayer] = useState<SwapLayer>(initialLayer === "ridge" || initialLayer === "floor" ? initialLayer : "summit");
  const fromParam = useSearchParam("from");
  const [from, setFrom] = useState<SwapToken>((fromParam ?? "").toUpperCase() === "USDC" ? "USDC" : "HYPE");
  const amountParam = useSearchParam("amount") ?? "";
  const [amount, setAmount] = useState(/^\d+(\.\d+)?$/u.test(amountParam) ? amountParam : "");
  const [venue, setVenue] = useState<string | null>(null);
  const [slippage, setSlippage] = useState<SlippageBps>(50);
  const settled = useDebounced(amount);
  const to: SwapToken = from === "HYPE" ? "USDC" : "HYPE";

  const ask = swapAsk(layer, from, settled, venue, slippage, mode);
  const plan = useFlowPlan(ask, address ?? null);
  const run = useFlowRun(ask, plan.data ?? null);
  // Probes for the price altitude: 1 HYPE on each EVM layer (dry runs, cached).
  const summitProbe = useFlowPlan(swapAsk("summit", "HYPE", "1", null, 50, mode, true), null);
  const ridgeProbe = useFlowPlan(swapAsk("ridge", "HYPE", "1", null, 50, mode, true), null);
  const reference = useQuery({
    queryKey: ["hypercore", "mainnet", "allMids-reference"],
    queryFn: () => infoClient("mainnet").post<Record<string, string>>({ type: "allMids" }),
    refetchInterval: 30_000,
  });
  const book = useQuery({
    queryKey: ["hypercore", mode, "allMids"],
    queryFn: () => infoClient(mode).post<Record<string, string>>({ type: "allMids" }),
    refetchInterval: 30_000,
  });
  const referencePx = Number(reference.data?.HYPE) || null;
  const bookPx = Number(book.data?.[HYPE_BOOK[mode]]) || null;
  const marks: AltitudeMark[] = [
    ...(referencePx ? [{ id: "reference", label: "Reference", price: referencePx, kind: "reference" as const, detail: "HyperCore mainnet" }] : []),
    ...(bookPx && mode === "testnet" ? [{ id: "book", label: "Floor book", price: bookPx, kind: "book" as const, detail: "HyperCore testnet" }] : []),
    ...probeMarks(summitProbe.data),
    ...probeMarks(ridgeProbe.data),
  ];

  const camp = layer === "summit" ? packs.summit : layer === "ridge" ? packs.ridge : packs.floor;
  const balance = camp[from];
  const max = balance !== null && balance > 0 ? String(from === "HYPE" && layer !== "floor" ? Math.max(0, Math.floor((balance - 0.01) * 1e6) / 1e6) : Math.floor(balance * 100) / 100) : undefined;
  const routed = plan.data && plan.data.kind !== "refused" ? plan.data.route : null;
  const quotes = routed?.quotes ?? [];
  const reset = () => run.reset();

  return (
    <Page className="pb-16">
      <section className="max-w-[1040px] pb-8 pt-4 sm:pt-10" aria-labelledby="swap-title">
        <p className="label-tab mb-5">Sheet 04 · Swap at the hut · {mode === "testnet" ? "practice wall" : "mainnet"}</p>
        <h1 id="swap-title" className="text-[44px] font-bold leading-[0.98] tracking-[-0.03em] text-ink sm:text-[72px]">
          Swap at the hut.
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">Kalos V3 and Dex Da Costa on the Summit, HyperSwap on the Ridge, the order book on the Floor. The minimum out goes into the transaction: a worse price reverts instead of filling.</p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12 xl:gap-8">
        <section className="el-laminate relative flex flex-col border-2 border-rule bg-card shadow-hard-lg lg:col-span-5" aria-labelledby="swap-ticket">
          <header className="flex items-center justify-between gap-3 border-b-2 border-rule px-4 py-3 sm:px-5">
            <h2 id="swap-ticket" className="text-[22px] font-bold leading-none tracking-[-0.02em] text-ink">
              Swap ticket
            </h2>
            <span className="caption">grade T1 · verified tokens</span>
          </header>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            <SegmentedControl
              label="Layer"
              fullWidth
              value={layer}
              onChange={(next) => {
                setLayer(next);
                setVenue(null);
                reset();
              }}
              options={(["summit", "ridge", "floor"] as const).map((value) => ({ value, label: value === "summit" ? "Summit" : value === "ridge" ? "Ridge" : "Floor", hint: LAYER_LABEL[value] }))}
            />
            {layer === "floor" ? (
              <div className="flex flex-col gap-3 border-2 border-dashed border-rule/60 p-4">
                <p className="text-[15px] leading-snug text-ink">The Floor swaps on the HyperCore order book: HYPE/USDC spot, with limits, TWAP and your Rule Book in the terminal.</p>
                <p className="tnum font-mono text-sm text-ink-2">book mid · {bookPx ? bookPx.toFixed(3) : "—"} USDC {mode === "testnet" ? "(testnet)" : ""}</p>
                <ButtonLink to={routeHref("trade", { market: "HYPE-USDC" })} variant="primary" size="lg" fullWidth>
                  Open HYPE/USDC on the Floor →
                </ButtonLink>
              </div>
            ) : (
              <>
                <NumberField
                  label={`You pay · ${LAYER_LABEL[layer]}`}
                  value={amount}
                  onChange={(next) => {
                    setAmount(next);
                    reset();
                  }}
                  decimals={from === "HYPE" ? 18 : 6}
                  max={max}
                  unit={from}
                  placeholder={from === "HYPE" ? "0.1" : "100"}
                  hint={address ? `in your pack: ${packFigure(balance, from === "HYPE" ? 4 : 2)} ${from}` : "connect to read your pack"}
                />
                <div className="relative flex items-center justify-center">
                  <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-rule/50" />
                  <button
                    type="button"
                    onClick={() => {
                      setFrom(to);
                      setAmount("");
                      reset();
                    }}
                    className={cx("relative border-2 border-rule bg-card px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-ink shadow-hard hover:bg-paper-2", FOCUS_RING)}
                    aria-label={`Flip: pay ${to}, receive ${from}`}
                  >
                    ⇅ flip
                  </button>
                </div>
                <div className="border-2 border-rule bg-paper/50 px-3 py-2.5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">You receive · {to}</p>
                  <p className="tnum mt-1 font-mono text-[30px] font-semibold leading-none text-ink" aria-live="polite">
                    {routed?.arrives ?? (plan.isFetching ? "…" : "—")}
                  </p>
                  <p className="tnum mt-1.5 font-mono text-xs text-ink-2">{routed?.minimum ? `at least ${routed.minimum} · or it reverts` : "the minimum out is set when the route is quoted"}</p>
                </div>
                <div>
                  <p className="caption mb-2">Venues · {quotes.length > 0 ? `${quotes.length} quoted` : VENUES[layer].length}</p>
                  <ul className="flex flex-col gap-2">
                    <li>
                      <Signpost destination="Best quote" detail="the planner picks the venue" highlight={venue === null} chosen={venue === null} swing={false} onClick={() => { setVenue(null); reset(); }} />
                    </li>
                    {VENUES[layer].map((item) => {
                      const quote = quotes.find((entry) => entry.protocol === item.id);
                      return (
                        <li key={item.id}>
                          <Signpost
                            destination={item.label}
                            eta={quote ? quote.out : undefined}
                            detail={quote?.excluded ? `not quoted: ${quote.excluded}` : quote?.winner ? `${item.note} · best` : item.note}
                            highlight={venue === item.id}
                            chosen={venue === item.id}
                            swing={false}
                            onClick={() => {
                              setVenue(item.id);
                              reset();
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="caption">Max slippage</span>
                  <SegmentedControl label="Max slippage" size="sm" value={String(slippage) as `${SlippageBps}`} onChange={(next) => { setSlippage(Number(next) as SlippageBps); reset(); }} options={SLIPPAGE_CHOICES.map((bps) => ({ value: String(bps) as `${SlippageBps}`, label: `${bps / 100}%` }))} />
                </div>
              </>
            )}
          </div>
        </section>

        <PriceAltitude className="lg:col-span-7" marks={marks} reference={referencePx} />
      </div>

      {layer !== "floor" ? (
        <section className="mt-10" aria-label="Route card">
          <FlowCard
            ask={ask}
            plan={plan.data}
            planning={plan.isFetching}
            updatedAt={plan.dataUpdatedAt}
            run={run}
            fineprint="Pool prices on the practice wall are not market prices; the card quotes the real pool."
            empty={
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-2 border-dashed border-rule/60 px-5 py-6">
                <p className="font-mono text-[15px] text-ink-2">“{swapSentence(layer, from, "", venue)}”</p>
                <p className="text-[15px] text-ink-2">Enter an amount: the planner quotes every venue, binds the best and writes its minimum out into the swap.</p>
              </div>
            }
          />
        </section>
      ) : null}

      <Reveal className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {[
          ["Minimum out, on chain", "The swap carries amountOutMinimum. If the pool moves past your slippage before it lands, it reverts and nothing is spent but gas."],
          ["Verified tokens only", "Canonical WHYPE and USDC from the pinned address book. At least seven look-alike WHYPEs exist on Elysium; Elyia never routes through them."],
          ["Native HYPE in", "Kalos wraps into canonical WHYPE inside the router. Dex Da Costa wraps into its own WETH; the card says which one you get."],
        ].map(([title, body]) => (
          <div key={title} className="border-2 border-rule bg-card p-4 shadow-hard">
            <p className="text-[17px] font-bold text-ink">{title}</p>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-2">{body}</p>
          </div>
        ))}
      </Reveal>
    </Page>
  );
}
