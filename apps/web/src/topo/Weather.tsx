import { cx } from "../ui/cx";
import { WEATHER_LABEL, type Weather as WeatherKind } from "./geometry/conditions";

export interface WeatherProps {
  readonly weather: WeatherKind;
  readonly size?: number;
  readonly showLabel?: boolean;
  /** Extra words for the label ("vol 62nd pct"). */
  readonly detail?: string;
  readonly className?: string;
}

const CLOUD = "M5 15.5h11.5a3.5 3.5 0 0 0 .2-7 4.6 4.6 0 0 0-8.8-1.3A3.6 3.6 0 0 0 5 15.5Z";

/** Volatility as sky over the market: clear, few clouds, overcast, storm. A small inline glyph. */
export function Weather({ weather, size = 20, showLabel = false, detail, className }: WeatherProps) {
  const label = `${WEATHER_LABEL[weather]}${detail ? ` · ${detail}` : ""}`;
  return (
    <span className={cx("inline-flex items-center gap-1.5 align-middle", className)} role="img" aria-label={`Weather: ${label}`}>
      <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" className="shrink-0" strokeLinejoin="round">
        {weather === "clear" || weather === "few" ? (
          <g transform={weather === "few" ? "translate(-3,-3) scale(0.8)" : undefined}>
            <circle cx="11" cy="11" r="4.6" fill="rgb(var(--signal))" stroke="rgb(var(--ink))" strokeWidth="1.4" />
            <path d="M11 2.2v2.2M11 17.6v2.2M2.2 11h2.2M17.6 11h2.2M4.8 4.8l1.5 1.5M15.7 15.7l1.5 1.5M4.8 17.2l1.5-1.5M15.7 6.3l1.5-1.5" stroke="rgb(var(--ink))" strokeWidth="1.4" strokeLinecap="square" />
          </g>
        ) : null}
        {weather === "few" ? <path d={CLOUD} transform="translate(2,3)" fill="rgb(var(--card))" stroke="rgb(var(--ink))" strokeWidth="1.4" /> : null}
        {weather === "overcast" ? (
          <>
            <path d={CLOUD} transform="translate(-2,-2) scale(0.9)" fill="rgb(var(--paper-3))" stroke="rgb(var(--ink))" strokeWidth="1.3" />
            <path d={CLOUD} transform="translate(1,2)" fill="rgb(var(--card))" stroke="rgb(var(--ink))" strokeWidth="1.4" />
          </>
        ) : null}
        {weather === "storm" ? (
          <>
            <path d={CLOUD} transform="translate(0,-2)" fill="rgb(var(--ink-2))" stroke="rgb(var(--ink))" strokeWidth="1.4" />
            <path d="M11.5 14.5 9 18.6h2.6l-1.4 3" fill="none" stroke="rgb(var(--signal))" strokeWidth="1.8" strokeLinecap="square" />
          </>
        ) : null}
      </svg>
      {showLabel ? <span className="font-mono text-[11px] text-ink-2">{label}</span> : null}
    </span>
  );
}
