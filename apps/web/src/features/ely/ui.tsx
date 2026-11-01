/**
 * Small shared pieces of Ely v2 (Ask Ely and Portfolio × Ely): the avatar,
 * pixel glyphs, the reading spinner, the toggle, the stamp, the turn clock
 * and a media-query hook. Every drawing goes through PixelCanvas (shared
 * ticker, integer scale, end state under reduced motion).
 */
import React, { useCallback } from "react";

import { PixelCanvas } from "../../pixel/PixelCanvas";
import { PixelGlyph } from "../../pixel/PixelGlyph";
import { cx, FOCUS_RING } from "../../ui/cx";
import { drawAvatar, drawSpinner, GLYPH_COLORS, GLYPHS, paletteOf, type AvatarState, type GlyphName } from "./draw";

export function Glyph({ name, scale = 3, label = null, className }: { readonly name: GlyphName; readonly scale?: number; readonly label?: string | null; readonly className?: string }) {
  return <PixelGlyph rows={GLYPHS[name]} scale={scale} palette={GLYPH_COLORS} label={label} className={className} />;
}

export function ElyAvatar({ state, scale = 2, label, className }: { readonly state: AvatarState; readonly scale?: number; readonly label?: string; readonly className?: string }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawAvatar(ctx, state, info.still ? 0.6 : info.seconds, paletteOf(ctx.canvas)), [state]);
  return <PixelCanvas width={20} height={22} scale={scale} draw={draw} animate fps={15} endTime={0.6} redrawKey={state} label={label ?? `Ely, ${state === "climb" ? "surveying" : state === "summit" ? "route ready" : state === "worry" ? "worried" : state === "talk" ? "talking" : "listening"}`} className={className} />;
}

/** The pixel spinner while a reading is in flight; a check (or a cross) once it settles. */
export function ReadingMark({ done, ok }: { readonly done: boolean; readonly ok: boolean }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number }) => drawSpinner(ctx, info.seconds, paletteOf(ctx.canvas)), []);
  if (done) {
    return ok ? (
      <Glyph name="check" scale={2} label={null} />
    ) : (
      <span aria-hidden="true" className="inline-grid h-[18px] w-[18px] place-items-center font-tag text-[11px] text-down">
        ✕
      </span>
    );
  }
  return <PixelCanvas width={9} height={9} scale={2} draw={draw} animate fps={8} decorative />;
}

export function Toggle({ checked, onChange, label, disabled, className }: { readonly checked: boolean; readonly onChange: (next: boolean) => void; readonly label: string; readonly disabled?: boolean; readonly className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cx("tg", FOCUS_RING, className)}>
      <i aria-hidden="true" />
    </button>
  );
}

export type StampTone = "up" | "acc" | "ink" | "dn" | "warn";

export function Stamp({ tone, children, thump = true, className }: { readonly tone: StampTone; readonly children: React.ReactNode; readonly thump?: boolean; readonly className?: string }) {
  return <span className={cx("stamp", tone, thump && "thump", className)}>{children}</span>;
}

