import { useMemo } from "react";

import { Link } from "../../app/routes/Link";
import { routeHref } from "../../app/routes/routeTable";
import { Reveal } from "../../motion/Reveal";
import { cssVars } from "../../motion/tokens";
import { useAutoPause } from "../../motion/useAutoPause";
import { Blaze } from "../../topo/Blaze";
import type { Grade } from "../../topo/geometry/conditions";
import { buildRelief, type ReliefHolding } from "../../topo/geometry/relief";
import { Signpost } from "../../topo/Signpost";
import { Tag } from "../../ui/Badge";
import { cx, FOCUS_RING } from "../../ui/cx";

const MINI_RANGE: readonly ReliefHolding[] = [
  { id: "a", symbol: "HYPE", usd: 12_000, layer: "floor", side: "long", leverage: 3 },
  { id: "b", symbol: "ETH", usd: 7_000, layer: "floor", side: "long" },
  { id: "c", symbol: "kHYPE", usd: 6_000, layer: "ridge" },
  { id: "d", symbol: "FART", usd: 2_400, layer: "floor", side: "short" },
  { id: "e", symbol: "USDC", usd: 4_000, layer: "summit" },
];

/** A thumbnail relief: the same generator as the real map, contours only. */
function MiniRelief({ seen }: { readonly seen: boolean }) {
  const model = useMemo(() => buildRelief(MINI_RANGE, { width: 300, height: 150, seed: 11, step: 6 }), []);
  return (
    <svg viewBox="0 0 300 150" className="h-full w-full" aria-hidden="true" data-el-hold={seen ? undefined : ""}>
      <g fill="none" strokeLinejoin="round" strokeLinecap="round">
        {model.contours.map((contour, index) =>
          contour.basin ? (
            <path key={index} d={contour.d} stroke="rgb(var(--down))" strokeWidth="0.9" strokeDasharray="2.5 2.5" strokeOpacity="0.85" className="el-draw-fade" style={cssVars({ "--el-delay": `${300 + index * 25}ms` })} />
          ) : (
            <path key={index} d={contour.d} pathLength={1} stroke="rgb(var(--contour))" strokeWidth={contour.index ? 1.5 : 0.8} strokeOpacity={contour.index ? 0.95 : 0.65} className="el-draw" style={cssVars({ "--el-delay": `${120 + index * 30}ms`, "--el-draw-dur": "1300ms" })} />
          ),
        )}
      </g>
      {model.hills
        .filter((hill) => hill.sign > 0 && hill.holding.usd >= 5_000)
        .map((hill) => (
          <path key={hill.holding.id} d={`M${hill.x.toFixed(1)},${(hill.y - 6).toFixed(1)} l5,8 h-10z`} fill="rgb(var(--ink))" />
        ))}
    </svg>
  );
}

function MiniSignposts({ seen }: { readonly seen: boolean }) {
  if (!seen) return null;
  return (
    <div className="flex w-full max-w-[250px] flex-col gap-2.5" aria-hidden="true">
      <Signpost destination="Elysium · bridge" eta="5 s" grade={2} />
      <Signpost destination="Swap · USDC" eta="0.3 s" grade={1} direction="left" highlight={false} index={1} />
    </div>
  );
}

/** The Guide's licence in miniature: permit, scope stamp, punched days. */
function MiniLicence() {
  return (
    <div aria-hidden="true" className="relative w-full max-w-[250px] border-2 border-rule bg-paper-2 px-3.5 py-3 shadow-hard">
      <p className="font-sans text-[13px] font-bold uppercase tracking-[0.06em]">Guide&apos;s licence</p>
      <p className="font-mono text-[10px] text-ink-2">No. 0x9c2b…41d0 · keeper</p>
      <p className="mt-2 inline-block border-1.5 border-rule bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.08em]">TRADE ONLY · CANNOT WITHDRAW</p>
      <p className="mt-2.5 flex items-center gap-1.5">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className={cx("h-2.5 w-2.5 rounded-full border-1.5 border-rule", index < 4 ? "bg-paper" : "bg-ink")} />
        ))}
        <span className="ml-1 font-mono text-[10px] text-ink-2">3 of 7 days left</span>
      </p>
      <span className="absolute -right-2 -top-3 rotate-[8deg] border-2 border-down px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-[0.1em] text-down" style={{ filter: "url(#el-rough)" }}>
        7 DAYS
      </span>
    </div>
  );
}

const RADIO = [
  ["14:02", "BASE → ROPE 2", "anchor moved to 3,295"],
  ["14:05", "BASE → YOU", "FARTCOIN rope 6%: halve it?"],
  ["14:05", "YOU → BASE", "halve ✓"],
] as const;

function MiniRadio() {
  return (
    <ol aria-hidden="true" className="w-full max-w-[260px] border-2 border-rule bg-card font-mono text-[11px] leading-snug shadow-hard">
      {RADIO.map(([at, route, message], index) => (
        <li key={index} className={cx("flex flex-col px-2.5 py-1.5", index > 0 && "border-t-1.5 border-dashed border-rule")}>
          <span className="text-ink-3">
            {at} · <span className="text-ink-2">{route}</span>
          </span>
          <span className="text-ink">{message}</span>
        </li>
      ))}
    </ol>
  );
}

interface Instrument {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly body: string;
  readonly to: string;
  readonly cta: string;
}

const INSTRUMENTS: readonly Instrument[] = [
  { id: "relief", number: "01", title: "See your range", body: "Floor, Ridge and Summit in one relief map: real exposure, rope left, funding and an avalanche bulletin for your whole book.", to: routeHref("portfolio"), cta: "Open the relief" },
  { id: "route", number: "02", title: "Speak the route", body: "A sentence becomes signposts and a route card. Every waypoint is quoted live, graded, and stamped only when the chain proves it.", to: routeHref("deck"), cta: "Write a route" },
  { id: "guide", number: "03", title: "Hire the Guide", body: "Liquidation guard, funding harvest, DCA, a daily brief. An optional keeper licence trades for you and can never withdraw.", to: routeHref("agent"), cta: "Meet the Guide" },
  { id: "radio", number: "04", title: "Radio from base camp", body: "Fills, fraying ropes, funding flips and bridge arrivals on Telegram. Approve with one tap; your own wallet signs.", to: routeHref("alerts"), cta: "Tune the radio" },
];

function Art({ id, seen }: { readonly id: string; readonly seen: boolean }) {
  if (id === "relief") return <MiniRelief seen={seen} />;
  if (id === "route") return <MiniSignposts seen={seen} />;
  if (id === "guide") return <MiniLicence />;
  return <MiniRadio />;
}

/** Four instruments, one survey: the map, the route, the guide and the radio. */
export function Instruments() {
  const { ref, seen } = useAutoPause<HTMLDivElement>({ rootMargin: "-10% 0px" });
  return (
    <section aria-labelledby="instruments-title" className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-10 lg:pb-28">
      <Reveal className="mb-10 flex flex-col gap-5">
        <Tag className="self-start">Four instruments · one survey</Tag>
        <h2 id="instruments-title" className="max-w-[18ch] text-[40px] font-bold leading-[1.02] tracking-[-0.02em] text-balance sm:text-[56px]">
          Everything you climb with, in one pack.
        </h2>
      </Reveal>
      <div ref={ref} className="grid grid-cols-1 gap-[2px] border-2 border-rule bg-rule shadow-hard-xl sm:grid-cols-2 xl:grid-cols-4">
        {INSTRUMENTS.map((instrument, index) => (
          <Reveal key={instrument.id} delay={index * 90} as="article" className="flex flex-col bg-card">
            <div className="flex h-[188px] items-center justify-center border-b-1.5 border-dashed border-rule bg-paper px-5 py-4">
              <Art id={instrument.id} seen={seen} />
            </div>
            <div className="flex flex-1 flex-col gap-3 px-5 pb-5 pt-4">
              <p className="caption">Instrument {instrument.number}</p>
              <h3 className="text-[24px] font-bold leading-tight tracking-[-0.015em]">{instrument.title}</h3>
              <p className="flex-1 text-[15px] leading-relaxed text-ink-2">{instrument.body}</p>
              <Link to={instrument.to} className={cx("self-start font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink underline decoration-accent-line decoration-2 underline-offset-4 hover:decoration-ink", FOCUS_RING)}>
                {instrument.cta} →
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const GRADES: ReadonlyArray<{ readonly grades: readonly [Grade, Grade]; readonly name: string; readonly body: string }> = [
  { grades: [1, 2], name: "Trail", body: "Swaps, stakes, bridges, transfers." },
  { grades: [3, 4], name: "Mountain", body: "Perps up to 10×, fresh but checked tokens." },
  { grades: [5, 6], name: "Alpine", body: "Above 10×, unverified tokens, first ascents." },
];

/** The route grades every action carries (SAC T1-T6, painted as trail blazes). */
export function GradesStrip() {
  return (
    <section aria-labelledby="grades-title" className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-10 lg:pb-28">
      <Reveal>
        <div className="grid grid-cols-1 gap-[2px] border-2 border-rule bg-rule lg:grid-cols-[minmax(0,0.9fr)_repeat(3,minmax(0,1fr))]">
          <div className="flex flex-col justify-center gap-1.5 bg-paper-2 px-5 py-5">
            <h2 id="grades-title" className="text-[22px] font-bold leading-tight tracking-[-0.01em]">
              Every move is graded.
            </h2>
            <p className="text-[14px] leading-snug text-ink-2">The blaze sits on the button, so you know the terrain before you sign.</p>
          </div>
          {GRADES.map((grade) => (
            <div key={grade.name} className="flex items-center gap-4 bg-card px-5 py-5">
              <span className="flex shrink-0 items-center gap-1.5">
                <Blaze grade={grade.grades[0]} size={22} />
              </span>
              <span className="min-w-0">
                <span className="block text-[17px] font-bold uppercase tracking-[0.03em]">
                  T{grade.grades[0]}–T{grade.grades[1]} · {grade.name}
                </span>
                <span className="block text-[14px] text-ink-2">{grade.body}</span>
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
