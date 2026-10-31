import type { NetworkEnvironment } from "@elyia/core/networks";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { useUiStore } from "../../app/state/uiStore";
import { infoClient } from "../../lib/hypercore/runtime";
import { Ely } from "../../pixel/Ely";
import { Cards, Page, Section, Split } from "../../pixel/layout";
import { PixelGlyph } from "../../pixel/PixelGlyph";
import { Signpost } from "../../topo/Signpost";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { NumberField } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { FlowCard } from "../track/flow/FlowCard";
import { FlowEmpty } from "../track/flow/FlowPixel";
import { sheetTag } from "../track/flow/pixelHooks";
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

/** The three guards, each with its pixel glyph (k ink, w card, y sun, r rope red, s paper). */
const GUARDS = [
  {
    title: "Minimum out, on chain",
    body: "The swap carries amountOutMinimum. If the pool moves past your slippage before it lands, it reverts and nothing is spent but gas.",
    glyph: ["...kkkkk...", "..k.....k..", "..k.....k..", "..k.....k..", ".kkkkkkkkk.", ".kyyyyyyyk.", ".kyyykyyyk.", ".kyyykyyyk.", ".kyyyyyyyk.", ".kkkkkkkkk."],
  },
  {
    title: "Verified tokens only",
    body: "Canonical WHYPE and USDC from the pinned address book. At least seven look-alike WHYPEs exist on Elysium; Elyia never routes through them.",
    glyph: [".kkkkkkkkk.", "kwwwwwwwwwk", "kwwwwwwwkwk", "kwwwwwwkkwk", "kwkwwwkkwwk", "kwkkwkkwwwk", ".kwkkkkwwk.", ".kwwkkwwwk.", "..kwwwwwk..", "...kwwwk...", "....kkk...."],
  },
  {
    title: "Native HYPE in",
    body: "Kalos wraps into canonical WHYPE inside the router. Dex Da Costa wraps into its own WETH; the card says which one you get.",
    glyph: ["..kkkkkkk..", ".krrrkrrrk.", "kkkkkkkkkkk", "kwwwkykwwwk", "kwwwkykwwwk", "kkkkkykkkkk", "kwwwkykwwwk", "kwwwkykwwwk", "kwwwkykwwwk", "kkkkkkkkkkk"],
  },
] as const;

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
    <Page className="!pt-0">
      <Section level={1} tag={sheetTag("04", "Swap at the hut", mode)} title="Swap at the hut." lede="Kalos V3 and Dex Da Costa on the Summit, HyperSwap on the Ridge, the order book on the Floor. The minimum out goes into the transaction: a worse price reverts instead of filling.">
        <PriceAltitude marks={marks} reference={referencePx} loading={reference.isPending} />
        <p className="mx-auto mt-6 max-w-[760px] text-center text-[13px] leading-relaxed text-ink-2 text-pretty">
          <span className="font-semibold text-ink">Reference</span> = the HyperCore mainnet mid, the only price Elyia shows as USD. Test USDC is unbacked, so practice-wall pools price HYPE in fantasy dollars; the route card still quotes the real pool and writes its minimum out into the transaction.
        </p>
      </Section>

      <Section id="ticket" tag="Swap ticket · grade T1 · verified tokens" title="Pay one, receive the other." lede="Pick the layer, name the amount, keep the best quote or choose the venue. The slippage you set becomes the floor of the trade.">
        <Split>
          <section className="flex flex-col gap-5 bg-card p-5 px-frame px-drop sm:p-6" aria-labelledby="swap-ticket">
            <h3 id="swap-ticket" className="text-center font-display text-[24px] font-bold leading-none text-ink">
              Ticket
            </h3>
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
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <Ely state="idle" size={88} label={null} />
                <p className="max-w-[420px] text-[15px] leading-snug text-ink text-pretty">The Floor swaps on the HyperCore order book: HYPE/USDC spot, with limits, TWAP and your Rule Book in the terminal.</p>
                <ButtonLink to={routeHref("trade", { market: "HYPE-USDC" })} variant="primary" size="lg">
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
                  <span aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t-4 border-dashed border-rule/30" />
                  <button
                    type="button"
                    onClick={() => {
                      setFrom(to);
                      setAmount("");
                      reset();
                    }}
                    className={cx("relative bg-card px-4 py-1.5 font-tag text-[12px] uppercase text-ink px-frame-thin px-drop px-press", FOCUS_RING)}
                    aria-label={`Flip: pay ${to}, receive ${from}`}
                  >
                    ▲▼ flip
                  </button>
                </div>
                <div className="flex flex-col items-center gap-1 bg-paper-2 px-4 py-4 text-center px-frame-thin">
                  <p className="font-tag text-[11px] uppercase text-ink-2">You receive · {to}</p>
                  <p className="tnum font-display text-[34px] font-bold leading-none text-ink" aria-live="polite">
                    {routed?.arrives ?? (plan.isFetching ? "…" : "—")}
                  </p>
                  <p className="tnum font-mono text-xs text-ink-2">{routed?.minimum ? `at least ${routed.minimum} · or it reverts` : "the minimum out is set when the route is quoted"}</p>
                </div>
              </>
            )}
          </section>

          <section className="flex flex-col gap-5 bg-card p-5 px-frame px-drop sm:p-6" aria-labelledby="swap-venues">
            <h3 id="swap-venues" className="text-center font-display text-[24px] font-bold leading-none text-ink">
              Venues
            </h3>
            <p className="caption text-center">{layer === "floor" ? "the order book" : quotes.length > 0 ? `${quotes.length} quoted · best wins` : `${VENUES[layer].length + 1} signposts`}</p>
            {layer === "floor" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <Signpost destination="HyperCore book" detail="HYPE/USDC spot · in the terminal" highlight swing={false} />
                <p className="tnum font-mono text-sm text-ink-2">
                  book mid · <span className="font-semibold text-ink">{bookPx ? bookPx.toFixed(3) : "—"}</span> USDC {mode === "testnet" ? "(testnet)" : ""}
                </p>
              </div>
            ) : (
              <>
                <ul className="flex flex-col gap-4">
                  <li>
                    <Signpost
                      destination="Best quote"
                      detail="the planner picks the venue"
                      highlight={venue === null}
                      chosen={venue === null}
                      swing={false}
                      onClick={() => {
                        setVenue(null);
                        reset();
                      }}
                    />
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
                <div className="mt-auto flex flex-col items-center gap-3 border-t-4 border-dashed border-rule/30 pt-5">
                  <span className="caption">Max slippage</span>
                  <SegmentedControl
                    label="Max slippage"
                    size="sm"
                    value={String(slippage) as `${SlippageBps}`}
                    onChange={(next) => {
                      setSlippage(Number(next) as SlippageBps);
                      reset();
                    }}
                    options={SLIPPAGE_CHOICES.map((bps) => ({ value: String(bps) as `${SlippageBps}`, label: `${bps / 100}%` }))}
                  />
                </div>
              </>
            )}
          </section>
        </Split>
      </Section>

      {layer !== "floor" ? (
        <Section id="route" tag="Route card · quoted, bound, signed" title="The swap, stamped as it lands." lede="Every venue quoted, the best one bound, its minimum out written into the swap. Each settled step gets its stamp from the chain.">
          <FlowCard
            ask={ask}
            plan={plan.data}
            planning={plan.isFetching}
            updatedAt={plan.dataUpdatedAt}
            run={run}
            fineprint="Pool prices on the practice wall are not market prices; the card quotes the real pool."
            empty={<FlowEmpty sentence={swapSentence(layer, from, "", venue)} help="Enter an amount: the planner quotes every venue, binds the best and writes its minimum out into the swap." />}
          />
        </Section>
      ) : null}

      <Section id="guards" tag="Field notes · three guards" title="What protects the swap.">
        <Cards n={3}>
          {GUARDS.map((guard) => (
            <div key={guard.title} className="flex flex-col items-center gap-3 bg-card px-5 py-6 text-center px-frame px-drop">
              <PixelGlyph rows={guard.glyph} scale={4} label={null} />
              <h3 className="font-display text-[20px] font-bold leading-tight text-ink">{guard.title}</h3>
              <p className="text-[14px] leading-relaxed text-ink-2 text-pretty">{guard.body}</p>
            </div>
          ))}
        </Cards>
      </Section>
    </Page>
  );
}
