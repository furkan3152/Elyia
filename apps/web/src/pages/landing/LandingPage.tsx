import { PROTOCOLS } from "@elyia/core/protocols";
import { ArrowRight, Bot, ChartCandlestick, MessageSquareText, Sparkles, Star } from "lucide-react";
import { useMemo } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { Reveal } from "../../motion/Reveal";
import { openOracle } from "../../oracle/oracleStore";
import { EXAMPLE_INTENTS } from "../../oracle/preview";
import { ButtonLink } from "../../ui/Button";
import { Chip } from "../../ui/Badge";
import { cx } from "../../ui/cx";
import { Panel } from "../../ui/Panel";
import { SOFT_TONE } from "../../ui/tones";
import { MarketsLyre } from "../../visuals/lyre/MarketsLyre";
import { LiveSun } from "../../visuals/sun/LiveSun";
import { BuildersCode } from "./BuildersCode";
import { ecosystemChips } from "./ecosystem";
import { HeroOracle } from "./HeroOracle";
import { PulseStats } from "./PulseStats";

const SECTION = "relative mx-auto max-w-[1280px] px-4 sm:px-8 lg:px-10";

const LAYERS = [
  {
    id: "speak",
    title: "Speak",
    icon: Sparkles,
    body: "“Bridge 20 HYPE to Elysium and swap half to USDC.” The Oracle compiles it into steps, quotes each one live and asks only what changes the result.",
    keys: "swap · bridge · stake · long · twap · alert",
  },
  {
    id: "trade",
    title: "Trade",
    icon: ChartCandlestick,
    body: "A keyboard-first HyperCore terminal: TP/SL, TWAP, scale orders, flatten-all, liquidation distance on every row. Orders are signed by a trade-only key that never leaves your browser.",
    keys: "B buy · S sell · F flatten · ⌘K",
  },
  {
    id: "see",
    title: "See",
    icon: Star,
    body: "Your own stars: perps, spot, vaults and staking on HyperCore, tokens on HyperEVM and Elysium — one constellation, one net worth, one exposure map.",
    keys: "PnL · funding · fees · liq distance",
  },
  {
    id: "agent",
    title: "Agent",
    icon: Bot,
    body: "The Elysium Agent guards your liquidations, harvests funding and briefs you on Telegram — inside limits you set with sliders and code enforces. It can trade, never withdraw.",
    keys: "propose · autopilot · keeper (opt-in)",
  },
] as const;

const JOURNEY = [
  { label: "Deposited 20 HYPE on HyperEVM", at: "1.2 s", tone: "mint" },
  { label: "Retryable ticket redeemed on Elysium", at: "4.8 s", tone: "mint" },
  { label: "Swapping 10 HYPE → USDC on Elysium", at: "now", tone: "gold" },
] as const;

/** "/" — Speak, and Elysium answers. */
export default function LandingPage() {
  const chips = useMemo(() => ecosystemChips(PROTOCOLS), []);
  return (
    <>
      <section id="top" className={cx(SECTION, "grid items-center gap-10 pb-10 pt-4 lg:grid-cols-[1.06fr_0.94fr] lg:gap-8 lg:pb-14 lg:pt-12")}>
        <div className="flex min-w-0 flex-col gap-7">
          <p className="eyebrow animate-fade-in">Built for Elysium · Hyperliquid&apos;s first L2</p>
          <h1 className="animate-rise-in font-display text-display-xl text-text-0 text-balance">
            Speak,
            <br />
            <span className="display-italic">and Elysium</span>
            <br />
            answers.
          </h1>
          <p className="max-w-[560px] text-[17px] leading-relaxed text-text-1 text-pretty sm:text-[19px]">
            One sentence becomes verified, wallet-signed steps across Elysium, HyperEVM and HyperCore. Trade perps, swap, stake, bridge and track every move — with an agent that can trade for
            you but can never withdraw.
          </p>
          <HeroOracle />
        </div>
        <div className="relative mx-auto w-full max-w-[540px]">
          <LiveSun />
        </div>
      </section>

      <section aria-label="Elysium at a glance" className={cx(SECTION, "pb-20 lg:pb-28")}>
        <PulseStats />
      </section>

      <section aria-labelledby="lyre-title" className={cx(SECTION, "grid items-center gap-10 pb-20 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14 lg:pb-28")}>
        <Reveal className="flex flex-col gap-5">
          <p className="eyebrow">The Lyre</p>
          <h2 id="lyre-title" className="font-display text-display-lg text-text-0">
            Seven strings.
            <br />
            <span className="display-italic">Your whole book.</span>
          </h2>
          <p className="max-w-md text-[17px] leading-relaxed text-text-1 text-pretty">
            Your seven biggest positions become seven strings. They hum with volatility, ring on every fill, glow mint when you are up and rose when you are down. Tap a string to trade it. Read
            your risk in one glance — before you read a single number.
          </p>
          <p className="max-w-md text-sm text-text-2">Flat? The Lyre plays the seven most traded HyperCore markets.</p>
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink to={routeHref("trade")} variant="soft" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
              See the terminal
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <Panel variant="raised" padding="lg" className="rounded-3xl">
            <MarketsLyre height={340} />
          </Panel>
        </Reveal>
      </section>

      <section aria-labelledby="layers-title" className={cx(SECTION, "pb-20 lg:pb-28")}>
        <Reveal>
          <p className="eyebrow">One deck, three layers</p>
          <h2 id="layers-title" className="mb-9 mt-4 max-w-4xl font-display text-display-lg text-text-0 text-balance">
            Everything Elysium can do, <span className="display-italic">in the words you already use.</span>
          </h2>
        </Reveal>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {LAYERS.map((layer, index) => {
            const Icon = layer.icon;
            return (
              <Reveal key={layer.id} delay={index * 90} id={layer.id} className="scroll-mt-24">
                <Panel interactive padding="lg" className="flex h-full flex-col gap-3.5 rounded-3xl">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-glow/25 bg-violet/[0.1] text-violet-soft">
                    <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={1.6} />
                  </span>
                  <h3 className="font-display text-[32px] leading-none text-text-0">{layer.title}</h3>
                  <p className="flex-1 text-sm leading-relaxed text-text-1">{layer.body}</p>
                  <p className="font-mono text-xs text-gold">{layer.keys}</p>
                </Panel>
              </Reveal>
            );
          })}
        </div>
      </section>

      <section aria-label="Track and Telegram" className={cx(SECTION, "grid gap-4 pb-20 lg:grid-cols-[1.15fr_0.85fr] lg:pb-28")}>
        <Reveal>
          <Panel variant="raised" padding="lg" className="h-full rounded-3xl bg-gradient-to-br from-violet/[0.14] via-bg-1 to-bg-1">
            <p className="eyebrow">Track every step</p>
            <h3 className="mt-3 font-display text-[clamp(1.9rem,3vw,2.5rem)] leading-tight text-text-0">
              Where is my money? <span className="display-italic">Always answered.</span>
            </h3>
            <ol className="mt-6 flex flex-col gap-3.5">
              {JOURNEY.map((step) => (
                <li key={step.label} className="flex items-center gap-3 text-sm">
                  <span aria-hidden="true" className={cx("h-2.5 w-2.5 shrink-0 rounded-full", step.tone === "mint" ? "bg-mint" : "el-loop animate-breathe bg-gold")} />
                  <span className="min-w-0 flex-1 text-text-0">{step.label}</span>
                  <span className={cx("tnum font-mono text-xs", step.tone === "gold" ? "text-gold" : "text-text-2")}>{step.at}</span>
                </li>
              ))}
            </ol>
            <p className="mt-5 font-mono text-xs text-text-2">example journey · every step proven from receipts, logs and the HyperCore info API</p>
          </Panel>
        </Reveal>
        <Reveal delay={100}>
          <Panel padding="lg" className="flex h-full flex-col gap-4 rounded-3xl">
            <p className="eyebrow">Telegram</p>
            <h3 className="font-display text-[clamp(1.9rem,3vw,2.5rem)] leading-tight text-text-0">
              Alerts that <span className="display-italic">act.</span>
            </h3>
            <p className="flex-1 text-sm leading-relaxed text-text-1">
              Liquidation distance, funding flips, fills, whale moves, bridge settled. Approve an agent proposal with one tap — the Mini App opens and your own wallet signs.
            </p>
            <div>
              <ButtonLink to="/tg" variant="gold" leftIcon={<MessageSquareText className="h-4 w-4" aria-hidden="true" />}>
                See the Mini App
              </ButtonLink>
            </div>
          </Panel>
        </Reveal>
      </section>

      <section aria-labelledby="fields-title" className={cx(SECTION, "pb-20 lg:pb-28")}>
        <Reveal>
          <p className="eyebrow">The Elysian fields</p>
          <h2 id="fields-title" className="mb-8 mt-4 font-display text-display-lg text-text-0 text-balance">
            Every protocol on Elysium, <span className="display-italic">one sentence away.</span>
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <ul className="flex flex-wrap gap-2.5" aria-label="Ecosystem">
            {chips.map((chip) => (
              <li key={chip.id} className="flex items-center gap-2 rounded-xl border border-line bg-bg-1/70 px-3.5 py-2 text-sm text-text-0 transition-colors hover:border-violet-glow/30">
                {chip.name}
                <span className={cx("rounded-md border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em]", SOFT_TONE[chip.tone])}>{chip.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-text-2">Statuses come from Elyia&apos;s protocol registry, checked on-chain; nothing is shown as live until it is.</p>
        </Reveal>
      </section>

      <section id="builders" aria-labelledby="builders-title" className={cx(SECTION, "grid items-center gap-10 pb-24 lg:grid-cols-2 lg:pb-32")}>
        <Reveal className="flex flex-col gap-5">
          <p className="eyebrow">Builders</p>
          <h2 id="builders-title" className="font-display text-display-lg text-text-0">
            The same deck, <span className="display-italic">as an API.</span>
          </h2>
          <p className="max-w-lg text-[17px] leading-relaxed text-text-1">
            Plan intents, track journeys, read portfolios and stream Elysium blocks over one REST and SSE API. AI agents get the same tools over MCP, and every proposal comes back as a signing
            link — the server never holds a key.
          </p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_INTENTS.slice(0, 3).map((example) => (
              <Chip key={example} mono tone="neutral" onClick={() => openOracle(example)}>
                {example}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink to={routeHref("developers")} variant="outline" rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
              Read the API
            </ButtonLink>
            <ButtonLink to={routeHref("elysium")} variant="ghost">
              Watch the pulse
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <BuildersCode />
        </Reveal>
      </section>
    </>
  );
}
