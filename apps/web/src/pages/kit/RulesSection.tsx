import { Cards, Grid, Section, Split } from "../../pixel/layout";
import { Panel } from "../../ui/Panel";
import { ImportLine } from "./KeySection";

const RULES = [
  ["01 · Axis", "Symmetry", "One centre axis, one 12-column grid (1200 px, 24 px gutters), centred section heads, equal cards."],
  ["02 · Pixel", "4 px unit", "Frames, shadows and spacing in multiples of 4. Corners step, shadows are one block, no radius, no blur."],
  ["03 · Altitude", "Everything is a map", "Backgrounds, portfolios, NFTs, loaders and charts speak height: colour = altitude."],
  ["04 · Ely", "The character speaks", "States ride on Ely: climbing, summit, holding on, asleep, on watch, talking. Never decoration."],
] as const;

const PRIMITIVES = [
  ["<Page width>", "The sheet: centred, 1200 px, 24 px gutters (wide · narrow · full)."],
  ["<Section tag title lede>", "A centred head on the axis, then content; dashed seams between sections."],
  ["<Grid cols>", "Equal spans on the 12-column grid (1, 2, 3, 4, 6, 12); one column on phones."],
  ["<Cards n>", "Equal cards per row; narrower screens use a divisor of n (4/2/1, 6/3/2, 3/1); short rows stay centred."],
  ["<Split mirrored>", "Exactly two equal halves; mirrored aligns both to the axis. Never 2/3 + 1/3."],
] as const;

/** 07 · The rules and the layout primitives that enforce them. */
export function RulesSection() {
  return (
    <Section id="rules" tag="07 · Our style · 4 rules" title="Build every page on the axis." lede="The layout primitives make symmetry the default. Page engineers compose with them and never hand-roll grids.">
      <Cards n={4} phone={1}>
        {RULES.map(([number, title, body]) => (
          <Panel key={number} as="article" padding="lg" className="flex h-full flex-col items-center text-center">
            <span className="font-tag text-[11px] uppercase text-summit-ink">{number}</span>
            <h3 className="mt-2 font-display text-[22px] font-bold text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
          </Panel>
        ))}
      </Cards>

      <h3 className="mb-6 mt-16 text-center font-display text-[28px] font-bold text-ink">Layout primitives</h3>
      <ImportLine>{'import { Page, Section, Grid, Cards, Split } from "src/pixel"'}</ImportLine>
      <Cards n={1}>
        <Panel variant="flat" padding="lg">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {PRIMITIVES.map(([name, body]) => (
              <div key={name} className="contents">
                <dt className="font-mono text-sm font-semibold text-ink md:text-right">{name}</dt>
                <dd className="text-sm text-ink-2">{body}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Cards>

      <p className="mb-4 mt-12 text-center font-tag text-[11px] uppercase text-ink-2">{"<Grid cols={12} keep>"} · the axis runs between columns 6 and 7</p>
      <div className="relative">
        <Grid cols={12} keep className="!gap-x-2 sm:!gap-x-6">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="flex h-12 items-center justify-center bg-accent/15 font-tag text-[11px] text-ink px-frame-thin">
              {index + 1}
            </div>
          ))}
        </Grid>
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-3 -top-3 left-1/2 w-1 -translate-x-1/2 bg-signal" />
      </div>

      <p className="mb-4 mt-12 text-center font-tag text-[11px] uppercase text-ink-2">{"<Split mirrored>"} · two equal halves facing the axis</p>
      <Split mirrored>
        <Panel padding="lg" className="flex h-full flex-col items-end text-right">
          <span className="font-tag text-[11px] uppercase text-floor">Left half</span>
          <p className="mt-2 max-w-[360px] text-sm text-ink-2">Aligns to its right edge, toward the axis.</p>
        </Panel>
        <Panel padding="lg" className="flex h-full flex-col items-start text-left">
          <span className="font-tag text-[11px] uppercase text-ridge">Right half</span>
          <p className="mt-2 max-w-[360px] text-sm text-ink-2">Aligns to its left edge, toward the axis.</p>
        </Panel>
      </Split>

      <Panel variant="well" padding="lg" className="mx-auto mt-14 max-w-[860px] text-center">
        <p className="caption !text-ink">Motion</p>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          Sprite frames, stepped easing, sunrise, clouds, the waving flag, confetti pixels, digits that roll only when they change. One shared clock drives every canvas; loops pause off screen and in hidden tabs. Nothing flashes above 3 Hz. With reduced motion (your system or the Motion switch) every drawing shows its end state.
        </p>
      </Panel>
    </Section>
  );
}
