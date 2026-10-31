import { useCallback } from "react";

import { LAYERS, type LayerName } from "../../pixel/ely";
import { Cards, Section, Split } from "../../pixel/layout";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { cx } from "../../ui/cx";
import { ImportLine, Specimen } from "./KeySection";

const INKS: ReadonlyArray<readonly [string, string, string]> = [
  ["paper", "--paper", "the page"],
  ["card", "--card", "cards, sheets"],
  ["ink", "--ink", "text, frames"],
  ["ink-2", "--ink-2", "secondary (AA)"],
  ["accent", "--accent", "glacier · primary"],
  ["signal", "--signal", "sun · you are here"],
  ["down", "--down", "rope red · ▼"],
  ["up", "--up", "▲ gains"],
];

const BAND_LABEL: Readonly<Record<LayerName, string>> = { Floor: "Floor · HyperCore", Ridge: "Ridge · HyperEVM", Summit: "Summit · Elysium", Gold: "Gold summit · rare" };

function Swatch({ name, variable, use }: { readonly name: string; readonly variable: string; readonly use: string }) {
  return (
    <li className="flex flex-col items-center gap-2 text-center">
      <span aria-hidden="true" className="h-10 w-full px-frame-thin" style={{ background: `rgb(var(${variable}))` }} />
      <span className="font-tag text-[11px] uppercase text-ink">{name}</span>
      <span className="text-xs leading-tight text-ink-2">{use}</span>
    </li>
  );
}

function Sheet({ night }: { readonly night: boolean }) {
  return (
    <div className="h-full px-frame px-drop">
    <div className={cx(night ? "el-night" : "el-day", "h-full bg-paper p-6 text-ink")}>
      <p className="caption mb-5 text-center !text-ink">{night ? "Night · paper #0E1512 · ink #EEE7D8" : "Day · paper #F2ECDD · ink #16201B"}</p>
      <ul className="grid grid-cols-4 gap-x-4 gap-y-5">
        {INKS.map(([name, variable, use]) => (
          <Swatch key={name} name={name} variable={variable} use={use} />
        ))}
      </ul>
    </div>
    </div>
  );
}

function BandStrip({ layer }: { readonly layer: LayerName }) {
  const palette = LAYERS[layer];
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number }) => {
      const step = info.w / palette.length;
      palette.forEach((colour, index) => {
        ctx.fillStyle = colour;
        ctx.fillRect(Math.round(index * step), 0, Math.ceil(step), info.h);
        // stepped contour pixels along each band edge
        if (index > 0) {
          ctx.fillStyle = "#16201B";
          for (let y = 0; y < info.h; y += 2) ctx.fillRect(Math.round(index * step) - (y % 4 === 0 ? 1 : 0), y, 1, 1);
        }
      });
    },
    [palette],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="px-frame-thin">
        <PixelCanvas width={60} height={6} pixelSize={4} draw={draw} label={`${BAND_LABEL[layer]} altitude bands`} redrawKey={layer} />
      </div>
      <p className="text-center font-tag text-[11px] uppercase text-ink-2">{BAND_LABEL[layer]}</p>
    </div>
  );
}

/** 01 · Tokens: two sheets, altitude bands, lettering. */
export function TokensSection() {
  return (
    <Section id="tokens" tag="01 · Tokens · two sheets" title="Pixel, altitude, one axis." lede="Glacier is the action, sun only highlights, rope red is danger. Gains and losses always carry ▲ ▼, never colour alone. Both sheets pass WCAG AA.">
      <ImportLine>{"tailwind: bg-paper · bg-card · text-ink · bg-accent · bg-signal · text-down · font-display · font-tag · px-frame"}</ImportLine>
      <Split>
        <Sheet night={false} />
        <Sheet night />
      </Split>
      <h3 className="mb-8 mt-16 text-center font-display text-[28px] font-bold text-ink">Altitude bands</h3>
      <Cards n={4}>
        {(Object.keys(LAYERS) as LayerName[]).map((layer) => (
          <BandStrip key={layer} layer={layer} />
        ))}
      </Cards>
      <h3 className="mb-8 mt-16 text-center font-display text-[28px] font-bold text-ink">Lettering</h3>
      <Cards n={3}>
        <Specimen label="Pixelify Sans · headings, big numbers">
          <p className="font-display text-[44px] font-bold leading-none text-ink">Where to?</p>
          <p className="mt-3 font-display text-[32px] font-bold text-ink tnum">$48,213</p>
        </Specimen>
        <Specimen label="Silkscreen · tags, labels, nav">
          <p className="font-tag text-[20px] uppercase leading-snug text-ink">Summit · Elysium</p>
          <p className="mt-3 font-tag text-[13px] uppercase text-ink-2">Deck · Trade · Portfolio · Guide</p>
        </Specimen>
        <Specimen label="IBM Plex Mono · body and data">
          <p className="text-[15px] leading-relaxed text-ink">Plain words, short sentences, the fix in every error.</p>
          <p className="tnum mt-3 font-mono text-[17px] font-semibold text-ink">18,514,484 · ▼ 3.5%</p>
        </Specimen>
      </Cards>
    </Section>
  );
}
