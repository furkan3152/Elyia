import { routeHref } from "../../app/routes/routeTable";
import { Reveal } from "../../motion/Reveal";
import { Tag } from "../../ui/Badge";
import { Button, ButtonLink } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { BarographBand } from "./BarographBand";
import { ElysiumFacts } from "./ElysiumFacts";
import { HeroMap } from "./HeroMap";
import { HeroRouteCard } from "./HeroRouteCard";
import { GradesStrip, Instruments } from "./Instruments";
import { RopeSection } from "./RopeSection";
import { useTrader } from "./useTrader";

/**
 * "/": the survey of the range. A live relief of a real testnet trader, the
 * route card you write into, Elysium's barograph, the rope, the instruments,
 * the grades and the summit's numbers.
 */
export default function LandingPage() {
  const trader = useTrader();
  return (
    <>
      <section aria-labelledby="hero-title" className="mx-auto grid max-w-[1440px] gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14 lg:px-10 lg:pb-24 lg:pt-14">
        <div className="flex min-w-0 flex-col gap-7 lg:pt-2">
          <Tag className="animate-fade-in self-start">Built for Elysium · HyperCore + HyperEVM + Elysium</Tag>
          <h1 id="hero-title" className="animate-rise-in text-[52px] font-bold leading-[0.98] tracking-[-0.03em] text-ink text-balance sm:text-[68px] xl:text-[80px]">
            Your money, surveyed like a mountain.
          </h1>
          <p className="max-w-[36rem] text-[18px] leading-relaxed text-ink-2 sm:text-[19px]">
            Every holding is a hill, every short a basin, every position a rope. Say where you want to go in one sentence; Elyia plans the route across the Floor, the Ridge and the Summit, and your own wallet signs each step.
          </p>
          <HeroRouteCard formId="hero-route" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button type="submit" form="hero-route" size="lg">
              Plan the route →
            </Button>
            <ButtonLink to={routeHref("trade")} variant="ink" size="lg">
              Trade the Floor
            </ButtonLink>
            <span className="hidden items-center gap-1.5 font-mono text-[12px] text-ink-2 sm:inline-flex">
              <Kbd>↵</Kbd> plans it · <Kbd>/</Kbd> opens Where to? anywhere
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <HeroMap trader={trader} />
        </div>
      </section>

      <BarographBand />
      <RopeSection trader={trader} />
      <Instruments />
      <GradesStrip />
      <ElysiumFacts />

      <section aria-labelledby="closing-title" className="mx-auto max-w-[1440px] px-4 pb-8 sm:px-6 lg:px-10">
        <Reveal className="flex flex-col items-start gap-8 border-t-2 border-rule pt-14 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-5">
            <p className="map-label max-w-[32ch] text-[28px] leading-tight text-ink-2 sm:text-[34px]">No snow there, nor heavy storm, nor ever rain. — the Odyssey, on Elysium</p>
            <h2 id="closing-title" className="text-[40px] font-bold leading-none tracking-[-0.02em] sm:text-[56px]">
              Where to?
            </h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={routeHref("deck")} size="xl">
              Open the deck →
            </ButtonLink>
            <ButtonLink to={routeHref("developers")} variant="ink" size="xl">
              Build on it
            </ButtonLink>
          </div>
        </Reveal>
      </section>
    </>
  );
}
