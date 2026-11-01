/**
 * Small pieces shared by the developer portal and the owner console (v2 style
 * A: tone-line frames, stepped corners, no ink outlines, no block shadows).
 */
import React from "react";

import { PixelGlyph } from "../../../pixel/PixelGlyph";
import { useReducedMotion } from "../../../motion/useReducedMotion";
import { cx } from "../../../ui/cx";
import { colourise, useTyped } from "./code";
import { PORTAL_GLYPH_PALETTE, PORTAL_GLYPHS, type PortalGlyphName } from "./glyphs";

import "./portal.css";

export function Glyph({ name, scale = 2, label = null, className }: { readonly name: PortalGlyphName; readonly scale?: number; readonly label?: string | null; readonly className?: string }) {
  return <PixelGlyph rows={PORTAL_GLYPHS[name]} palette={PORTAL_GLYPH_PALETTE} scale={scale} label={label} className={className} />;
}

export type Tone = "acc" | "up" | "dn" | "mute" | "sig" | "warn" | "ink";

const PILL: Readonly<Record<Tone, string>> = {
  acc: "bg-accent/15 text-accent",
  up: "bg-up/15 text-up",
  dn: "bg-down/15 text-down",
  mute: "bg-paper-2 text-ink-2",
  sig: "bg-signal/30 text-ink",
  warn: "bg-warn/20 text-warn-ink",
  ink: "bg-ink text-paper",
};

/** A small tag pill. Pass `dot` for a status square (the word always says it too). */
export function Pill({ tone = "mute", dot = false, children, className }: { readonly tone?: Tone; readonly dot?: boolean; readonly children: React.ReactNode; readonly className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-[3px] font-tag text-[10px] uppercase leading-none tracking-[0.04em]", PILL[tone], className)}>
      {dot ? <span aria-hidden="true" className="inline-block h-[6px] w-[6px] bg-current" /> : null}
      {children}
    </span>
  );
}

/** A frame card (`.fr`). `emphasis` is the one strong card of a view; `accent` outlines it in glacier. */
export function Card({ as: Element = "div", emphasis = false, accent = false, flat = false, className, children, ...rest }: React.HTMLAttributes<HTMLElement> & { readonly as?: "div" | "section" | "article" | "li"; readonly emphasis?: boolean; readonly accent?: boolean; readonly flat?: boolean }) {
  return (
    <Element className={cx("px-frame bg-card", !flat && (emphasis ? "px-drop-lg" : "px-drop"), accent && "px-tone-accent", "p-5", className)} {...rest}>
      {children}
    </Element>
  );
}

export function CardHead({ glyph, title, right, id, as: Heading = "h3" }: { readonly glyph?: PortalGlyphName; readonly title: React.ReactNode; readonly right?: React.ReactNode; readonly id?: string; readonly as?: "h2" | "h3" }) {
  return (
    <div className="mb-4 flex min-h-[32px] items-center justify-between gap-3">
      <Heading id={id} className="flex min-w-0 items-center gap-2.5 font-display text-[19px] font-bold leading-tight text-ink">
        {glyph ? <Glyph name={glyph} /> : null}
        <span className="truncate">{title}</span>
      </Heading>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function Stat({ label, value, note, className }: { readonly label: string; readonly value: React.ReactNode; readonly note: React.ReactNode; readonly className?: string }) {
  return (
    <Card className={cx("flex flex-col items-center justify-center gap-1.5 py-5 text-center", className)}>
      <span className="font-tag text-[10px] uppercase tracking-[0.08em] text-ink-2">{label}</span>
      <span className="font-display text-[30px] font-bold leading-none text-ink tnum">{value}</span>
      <span className="text-[11.5px] text-ink-3">{note}</span>
    </Card>
  );
}

/** Text stamp (`.stamp`): rotated, tone-lined; thumps in when `go` flips on. */
export function TextStamp({ tone, children, go = true, className }: { readonly tone: "up" | "acc" | "ink" | "dn" | "warn"; readonly children: React.ReactNode; readonly go?: boolean; readonly className?: string }) {
  const colour = { up: "rgb(var(--up))", acc: "rgb(var(--accent))", ink: "rgb(var(--ink-3))", dn: "rgb(var(--down))", warn: "rgb(var(--warn-ink))" }[tone];
  return (
    <span data-go={go ? "true" : undefined} className={cx("px-stamp px-frame-thin inline-block bg-card px-2 py-[3px] font-tag text-[10px] uppercase leading-none", !go && "invisible", className)} style={{ "--stamp-c": colour } as React.CSSProperties}>
      {children}
    </span>
  );
}

export function KV({ rows, className, wide = false }: { readonly rows: ReadonlyArray<readonly [React.ReactNode, React.ReactNode]>; readonly className?: string; readonly wide?: boolean }) {
  return (
    <dl className={cx("grid gap-x-4 gap-y-2 text-[12.5px]", wide ? "grid-cols-[112px_1fr]" : "grid-cols-[84px_1fr]", className)}>
      {rows.map(([key, value], index) => (
        <React.Fragment key={index}>
          <dt className="pt-[2px] font-tag text-[10px] uppercase tracking-[0.06em] text-ink-3">{key}</dt>
          <dd className="m-0 min-w-0 break-words text-ink">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** The lit console screen: fixed ink and phosphor on both sheets. */
export const SCREEN = "bg-[#16201B] text-[#CFEFF3]";

export function CodeHead({ left, right, rightTone = "mute" }: { readonly left: React.ReactNode; readonly right?: React.ReactNode; readonly rightTone?: "mute" | "ok" | "warn" }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 px-4 py-2 font-tag text-[10px] uppercase tracking-[0.06em]", "bg-[#25332C] text-[#CFEFF3]")}>
      <span className="truncate">{left}</span>
      {right ? <span className={rightTone === "ok" ? "text-[#5FD39A]" : rightTone === "warn" ? "text-[#F2C200]" : "text-[#9FB8B0]"}>{right}</span> : null}
    </div>
  );
}

/** A code block on the lit screen; `typeCps` types the text in (end state under reduced motion). */
export function Code({ text, typeCps, className, label, highlight = true }: { readonly text: string; readonly typeCps?: number; readonly className?: string; readonly label?: string; readonly highlight?: boolean }) {
  const reduced = useReducedMotion();
  const shown = useTyped(text, typeCps && !reduced ? typeCps : 0);
  const done = shown.length >= text.length;
  return (
    <pre aria-label={label} className={cx("m-0 overflow-auto whitespace-pre px-4 py-3 font-mono text-[12px] leading-[1.6]", SCREEN, className)}>
      <code>{highlight ? colourise(shown) : shown}</code>
      {done ? null : <span aria-hidden="true" className="portal-cursor inline-block h-[1.1em] w-[0.6em] translate-y-[2px] bg-[#CFEFF3]" />}
    </pre>
  );
}

/** Labelled sample data: never mistaken for live numbers. */
export function SampleTag({ children = "Sample data" }: { readonly children?: React.ReactNode }) {
  return <Pill tone="warn">{children}</Pill>;
}

export function SectionHead({ id, tag, title, lede }: { readonly id: string; readonly tag: string; readonly title: string; readonly lede?: React.ReactNode }) {
  return (
    <header className="mx-auto mb-8 flex max-w-[760px] flex-col items-center text-center">
      <span className="label-tab font-tag text-[10px] uppercase tracking-[0.08em]">{tag}</span>
      <h2 id={id} className="mt-4 font-display text-[clamp(1.9rem,3.4vw,2.6rem)] font-bold leading-[1.08] text-ink">
        {title}
      </h2>
      {lede ? <p className="mt-3 max-w-[620px] text-[14.5px] leading-relaxed text-ink-2 text-pretty">{lede}</p> : null}
    </header>
  );
}

/** Stepped dash meter (sun near quota). The fraction is also written as text next to it by the caller. */
export function Meter({ fraction, warnAt = 0.8, label }: { readonly fraction: number; readonly warnAt?: number; readonly label: string }) {
  const dashes = 40;
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * dashes);
  const hot = fraction >= warnAt;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="portal-meter flex h-[10px] gap-[2px]">
      {Array.from({ length: dashes }, (_, index) => (
        <span key={index} style={{ animationDelay: `${Math.floor(index / 10) * 80}ms` }} className={cx("h-full flex-1", index < lit ? (hot ? "bg-signal" : "bg-accent") : "bg-paper-3")} />
      ))}
    </div>
  );
}
