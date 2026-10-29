import { Link } from "../../app/routes/Link";
import { MotionToggle } from "../../app/shell/MotionToggle";
import { ThemeToggle } from "../../app/shell/ThemeToggle";
import { ContourField } from "../../topo/ContourField";
import { HutStamp } from "../../topo/HutStamp";
import { Rope } from "../../topo/Rope";
import { Signpost } from "../../topo/Signpost";
import { Badge, LayerChip, Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Panel, PanelHeader } from "../../ui/Panel";
import { ArtifactsSection } from "./ArtifactsSection";
import { KeySection } from "./KeySection";
import { PrimitivesSection } from "./PrimitivesSection";

const NAV = [
  ["bands", "Layers"],
  ["inks", "Inks"],
  ["lettering", "Lettering"],
  ["sheets", "Two sheets"],
  ["buttons", "Actions"],
  ["labels", "Labels"],
  ["panels", "Sheets"],
  ["controls", "Controls"],
  ["inputs", "Fields"],
  ["overlays", "Overlays"],
  ["table", "Log book"],
  ["relief", "Relief"],
  ["route", "Route card"],
  ["rope", "Rope"],
  ["profile", "Profile"],
  ["avalanche", "Bulletin"],
  ["guide", "Licence"],
  ["barograph", "Barograph"],
] as const;

const BANDS = [
  { layer: "summit" as const, title: "The Summit · Elysium", detail: "99801 · 99901 · glacier aqua", className: "bg-summit-ink text-card" },
  { layer: "ridge" as const, title: "The Ridge · HyperEVM", detail: "998 · 999 · rock ochre", className: "bg-ridge text-card" },
  { layer: "floor" as const, title: "The Floor · HyperCore", detail: "order books · glacial lake", className: "bg-floor text-card" },
];

const INKS: ReadonlyArray<readonly [string, string, string]> = [
  ["paper", "--paper", "page"],
  ["card", "--card", "sheets, cards"],
  ["paper-2", "--paper-2", "folds, wells"],
  ["ink", "--ink", "text, borders"],
  ["ink-2", "--ink-2", "secondary text"],
  ["ink-3", "--ink-3", "tertiary (AA)"],
  ["accent", "--accent", "primary action"],
  ["contour", "--contour", "contour ink"],
  ["signal", "--signal", "highlight · you are here"],
  ["up", "--up", "▲ gains, longs"],
  ["down", "--down", "▼ losses, shorts"],
  ["warn", "--warn", "caution"],
];

function Swatch({ name, variable, use }: { readonly name: string; readonly variable: string; readonly use: string }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className="h-8 w-10 shrink-0 border-2 border-rule" style={{ background: `rgb(var(${variable}))` }} />
      <span className="min-w-0">
        <span className="block font-mono text-xs font-semibold text-ink">{name}</span>
        <span className="block font-mono text-[11px] text-ink-3">{use}</span>
      </span>
    </li>
  );
}

function SheetSample({ night }: { readonly night: boolean }) {
  return (
    <div className={cx(night ? "el-night" : "el-day", "relative overflow-hidden border-2 border-rule bg-paper p-5 text-ink")}>
      <ContourField seed={night ? 9 : 4} strength={1.4} />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Tag>{night ? "Night sheet · headlamp" : "Day sheet · paper map"}</Tag>
          <Badge tone="signal" variant="solid">
            Sample
          </Badge>
        </div>
        <p className="text-[28px] font-bold leading-tight tracking-[-0.02em]">19% to the crevasse.</p>
        <Panel padding="sm">
          <PanelHeader title="ETH 5× long" className="mb-1" />
          <Rope side="long" entry={3950} mark={4072} liquidation={3298} stop={3600} takeProfit={4600} />
        </Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Set anchor</Button>
          <Button variant="ink">Halve it</Button>
          <HutStamp layer="floor" block="41,077,288" time="14:02:11" size={64} />
        </div>
        <div className="max-w-sm">
          <Signpost destination="Elysium · bridge" eta="5 s" grade={2} swing={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * /system: the living map key. The Survey system's tokens, primitives and
 * every drawn artifact in its states, with sample data labelled as sample.
 * This page is the visual QA surface for everyone building pages.
 */
export default function SystemPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6 lg:px-10">
      <header className="relative grid grid-cols-1 gap-8 pb-10 pt-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:pt-14">
        <div>
          <Tag>Sheet K · map key · the Survey system</Tag>
          <h1 className="mt-6 text-[48px] font-bold leading-[1] tracking-[-0.02em] text-ink sm:text-[64px] lg:text-[74px]">
            The map key.
          </h1>
          <p className="mt-5 max-w-xl text-[18px] leading-relaxed text-ink-2">
            Everything Elyia draws, in its states, on both sheets. Import primitives from <code className="font-mono text-[15px] text-ink">src/ui</code>, drawn artifacts from{" "}
            <code className="font-mono text-[15px] text-ink">src/topo</code>, motion from <code className="font-mono text-[15px] text-ink">src/motion</code>. Every value on this sheet is sample data.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <MotionToggle />
            <span className="font-mono text-xs text-ink-3">Switch sheets and motion to check every artifact.</span>
          </div>
        </div>
        <nav aria-label="Map key sections" className="self-end">
          <p className="caption mb-3">Index</p>
          <ol className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[13px] sm:grid-cols-3">
            {NAV.map(([id, label], index) => (
              <li key={id}>
                <Link to={`#${id}`} className={cx("group flex items-baseline gap-2 py-0.5 text-ink-2 hover:text-ink", FOCUS_RING)}>
                  <span className="tnum text-[11px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
                  <span className="underline decoration-transparent decoration-2 underline-offset-4 group-hover:decoration-accent-line">{label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <div className="flex flex-col gap-14">
        <KeySection id="bands" number="01" title="Altitude bands = the three layers" description="Elysium settles to HyperEVM, which is co-located with HyperCore: the Summit stands on the Ridge, the Ridge on the Floor. Bridging is ascent and descent.">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <ol className="border-2 border-rule shadow-hard-lg">
              {BANDS.map((band) => (
                <li key={band.layer} className={cx("flex items-end justify-between gap-4 border-b-2 border-rule px-5 py-4 last:border-b-0", band.className)}>
                  <span>
                    <span className="block text-2xl font-bold uppercase tracking-[0.02em]">{band.title}</span>
                    <span className="block font-mono text-xs opacity-90">{band.detail}</span>
                  </span>
                  {band.layer === "ridge" ? <span className="font-mono text-xs">↑ up fast · ↓ down 5.5 d</span> : null}
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                <LayerChip layer="floor" network />
                <LayerChip layer="ridge" network />
                <LayerChip layer="summit" network />
              </div>
              <p className="text-[15px] leading-relaxed text-ink-2">Withdrawals from the Summit take the long trail down (about 5.5 days on mainnet), so every journey shows its descent time. Layer names on maps are cartographic labels:</p>
              <p className="map-label text-[34px] leading-tight text-floor">
                The Floor <span className="text-ridge">· The Ridge</span> <span className="text-summit-ink">· The Summit</span>
              </p>
            </div>
          </div>
        </KeySection>

        <KeySection id="inks" number="02" title="Inks on two sheets" description="Glacier is the action colour. Yellow only highlights: you are here, the live step, the latest digit. Gains and losses always carry ▲ ▼ chevrons, never colour alone.">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="el-day border-2 border-rule bg-paper p-5">
              <p className="caption mb-4 !text-ink">Day · paper map</p>
              <ul className="grid grid-cols-2 gap-3">
                {INKS.map(([name, variable, use]) => (
                  <Swatch key={name} name={name} variable={variable} use={use} />
                ))}
              </ul>
            </div>
            <div className="el-night border-2 border-rule bg-paper p-5 text-ink">
              <p className="caption mb-4 !text-ink">Night · headlamp</p>
              <ul className="grid grid-cols-2 gap-3">
                {INKS.map(([name, variable, use]) => (
                  <Swatch key={name} name={name} variable={variable} use={use} />
                ))}
              </ul>
            </div>
          </div>
        </KeySection>

        <KeySection id="lettering" number="03" title="Lettering" description="Space Grotesk for headlines and reading, IBM Plex Mono for every number and caption, Instrument Serif italic for map labels only.">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div>
              <p className="text-[56px] font-bold leading-none tracking-[-0.02em] text-ink">Where to?</p>
              <p className="caption mt-3">Space Grotesk 700 · −0.02em · 56–80 px hero, 32–40 px titles</p>
              <p className="mt-4 text-[18px] leading-relaxed text-ink-2">Plain words, short sentences, the fix in every error. Body 17–19 px on the site, 15 px in the deck.</p>
            </div>
            <div>
              <p className="tnum font-mono text-[24px] font-semibold leading-snug text-ink">18,514,484 · 3,342.7 · ▼ 3.5%</p>
              <p className="caption mt-3">IBM Plex Mono · every number, tabular</p>
              <p className="caption mt-4 !text-ink">Route 7F3A · 5 waypoints · grade T2</p>
              <p className="caption mt-1">Captions: mono micro-caps with “ · ”</p>
            </div>
            <div>
              <p className="map-label text-[40px] leading-tight text-water">Mer de nuages · Lac de la Floor</p>
              <p className="caption mt-3">Instrument Serif italic · map labels only</p>
            </div>
          </div>
        </KeySection>

        <KeySection id="sheets" number="04" title="Two sheets, side by side" description="The same artifacts on the DAY sheet and the NIGHT sheet, regardless of the page's own theme. Both pass WCAG AA for text.">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SheetSample night={false} />
            <SheetSample night />
          </div>
        </KeySection>

        <PrimitivesSection />
        <ArtifactsSection />

        <section className="border-t-2 border-rule pt-8">
          <p className="caption">Motion</p>
          <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-2">
            Contours draw on, cards rise 8 px, signposts swing in, stamps thump, windsocks flutter, the rope’s climber eases with the mark, the barograph needle kicks per block and the altimeter rolls only the digits that changed. Nothing flashes as a whole above
            3 Hz. With reduced motion (your system, or the Motion switch) every loop stops and shows its end state; loops also pause off screen and in hidden tabs.
          </p>
        </section>
      </div>
    </div>
  );
}
