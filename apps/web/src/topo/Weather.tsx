import { useMemo } from "react";

import { weatherGlyph } from "../pixel/glyphs";
import { PixelGlyph } from "../pixel/PixelGlyph";
import { cx } from "../ui/cx";
import { WEATHER_LABEL, type Weather as WeatherKind } from "./geometry/conditions";

export interface WeatherProps {
  readonly weather: WeatherKind;
  /** px height of the glyph (rounded to whole pixels). */
  readonly size?: number;
  readonly showLabel?: boolean;
  /** Extra words for the label ("vol 62nd pct"). */
  readonly detail?: string;
  readonly className?: string;
}

/** Volatility as sky over the market, as a 13 x 13 pixel glyph: clear, few clouds, overcast, storm. */
export function Weather({ weather, size = 20, showLabel = false, detail, className }: WeatherProps) {
  const label = `${WEATHER_LABEL[weather]}${detail ? ` · ${detail}` : ""}`;
  const rows = useMemo(() => weatherGlyph(weather), [weather]);
  return (
    <span className={cx("inline-flex items-center gap-1.5 align-middle", className)} role="img" aria-label={`Weather: ${label}`}>
      <PixelGlyph rows={rows} scale={Math.max(1, Math.round(size / 13))} label={null} />
      {showLabel ? <span className="font-tag text-[11px] uppercase text-ink-2">{label}</span> : null}
    </span>
  );
}
