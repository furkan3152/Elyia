import { routeHref } from "../../app/routes/routeTable";
import { useNow } from "../../hooks/useNow";
import { Ely } from "../../pixel/Ely";
import { Page, Section } from "../../pixel/layout";
import { PixelScene } from "../../pixel/PixelScene";
import { Tag } from "../../ui/Badge";
import { Button, ButtonLink } from "../../ui/Button";
import { Kbd } from "../../ui/Kbd";
import { Grades } from "./Grades";
import { HerdTeaser } from "./HerdTeaser";
import { HeroRouteCard } from "./HeroRouteCard";
import { daysUntil, MAINNET_AT } from "./model";
import { PulseReadouts } from "./PulseReadouts";
import { RopeSection } from "./RopeSection";
import { StatesStrip } from "./StatesStrip";
import { TerrainSection } from "./TerrainSection";
import { useTrader } from "./useTrader";

/** The closing call: Ely on the summit, one question, two ways up. */
function Closing() {
  const now = useNow(60_000);
  const days = daysUntil(MAINNET_AT, now);
  return (
    <Section id="where-to" className="pb-8 sm:pb-10">
      <div className="mx-auto flex max-w-[760px] flex-col items-center text-center">
        <Ely state="summit" size={176} label="Ely on the summit, flag planted" />
        <Tag className="mt-8">{days > 0 ? `Elysium mainnet · 9 Nov 2026 · ${days} ${days === 1 ? "day" : "days"} to go` : "Elysium mainnet · open"}</Tag>
        <h2 id="where-to-title" className="mt-5 font-display text-[clamp(3rem,8vw,5.5rem)] font-bold leading-none text-ink">
          Where to?
        </h2>
        <p className="mt-5 max-w-[560px] text-[17px] leading-relaxed text-ink-2 text-pretty">“No snow there, nor heavy storm, nor ever rain.” The Odyssey, on Elysium. Your keys stay in your wallet; Ely only carries the map.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-7">
          <ButtonLink to={routeHref("deck")} size="xl">
            Open the deck →
          </ButtonLink>
          <ButtonLink to={routeHref("developers")} variant="ink" size="xl">
            Build on it
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

/**
 * "/": the Pixel Survey of the range. Ely climbs the hero range over a live
 * Elysium barograph; the route card you write into; a real testnet trader's
 * ropes and terrain; Ely's states; The Herd; the grades; the way in.
 */
export default function LandingPage() {
  const trader = useTrader();
  return (
    <Page className="!pt-0 !pb-0">
      <Section
        id="hero"
        level={1}
        tag="Pixel survey · built for Elysium · HyperCore + HyperEVM + Elysium"
        title={
          <>
            Every block a step.
            <br />
            Ely climbs to the summit.
          </>
        }
        lede="Your money, surveyed like a mountain. HyperCore is the Floor, HyperEVM the Ridge, Elysium the Summit: say where you want to go in one sentence, Elyia plans the route, and your own wallet signs each step."
      >
        <PixelScene label="Pixel mountain range: Ely climbs the trail from the Floor (HyperCore) over the Ridge (HyperEVM) to the Summit (Elysium) and plants the flag; along the bottom, one tick per live Elysium block" />
        <PulseReadouts />
      </Section>

      <Section
        id="route"
        tag="Route card · one sentence"
        title="Say where. Ely finds the way."
        lede="Write it the way you would say it, in English or Turkish. Elyia reads the words, marks the altitudes the route travels and grades it; Ely stands on the highest one. Press Enter to plan it in the deck."
      >
        <div className="mx-auto max-w-[800px]">
          <HeroRouteCard formId="hero-route" />
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-7">
          <Button type="submit" form="hero-route" size="lg">
            Plan the route →
          </Button>
          <ButtonLink to={routeHref("trade")} variant="ink" size="lg">
            Trade the Floor
          </ButtonLink>
        </div>
        <p className="mt-6 hidden items-center justify-center gap-2 font-tag text-[11px] uppercase text-ink-2 sm:flex">
          <Kbd>↵</Kbd> plans it · <Kbd>/</Kbd> opens Where to? anywhere
        </p>
      </Section>

      <RopeSection trader={trader} />
      <TerrainSection trader={trader} />
      <StatesStrip />
      <HerdTeaser />
      <Grades />
      <Closing />
    </Page>
  );
}
