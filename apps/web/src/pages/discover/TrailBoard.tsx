import { PROTOCOLS } from "@elyia/core/protocols";
import { useId, useMemo, useState } from "react";

import { intentHref } from "../../oracle/preview";
import { ConditionSign } from "../../topo/ConditionSign";
import type { Layer } from "../../topo/geometry/relief";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Toggle } from "../../ui/Toggle";
import { boardCategories, boardSigns, EMPTY_FILTER, filterBoard, networkShort, statusShort, type BoardFilter, type BoardSign } from "./board";

const LAYER_BAR: Readonly<Record<Layer, string>> = { summit: "bg-summit", ridge: "bg-ridge", floor: "bg-floor" };
const LAYER_TEXT: Readonly<Record<Layer, string>> = { summit: "text-summit-ink", ridge: "text-ridge", floor: "text-floor" };
const LAYER_NAME: Readonly<Record<Layer, string>> = { summit: "Summit", ridge: "Ridge", floor: "Floor" };

function Sign({ sign }: { readonly sign: BoardSign }) {
  return (
    <li className="relative flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard">
      <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-[6px] border-r-2 border-rule", LAYER_BAR[sign.altitude])} />
      <div className="flex flex-1 flex-col gap-3 py-3.5 pl-6 pr-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cx("font-mono text-[10px] font-semibold uppercase tracking-[0.14em]", LAYER_TEXT[sign.altitude])}>
              {LAYER_NAME[sign.altitude]} · {sign.category.replace("-", " ")}
            </p>
            <h3 className="mt-0.5 text-[18px] font-bold leading-tight tracking-[-0.01em] text-ink">{sign.name}</h3>
          </div>
          {sign.executable ? <span className="shrink-0 border-1.5 border-rule bg-signal px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] text-signal-ink">ELYIA ROUTES</span> : null}
        </div>
        <p className="line-clamp-3 text-[13.5px] leading-snug text-ink-2">{sign.description}</p>
        <ConditionSign condition={sign.condition} reason={sign.reason} size="sm" />
        <ul className="flex flex-wrap gap-1.5" aria-label="Deployments">
          {sign.deployments.map((deployment) => (
            <li key={`${deployment.network}-${deployment.status}`} className={cx("border-1.5 px-1.5 py-px font-mono text-[10.5px]", deployment.status === "live" || deployment.status === "testnet-live" ? "border-rule text-ink" : "border-dashed border-rule/50 text-ink-2")}>
              <span className={cx("font-semibold", LAYER_TEXT[deployment.layer])}>{networkShort(deployment.network)}</span> · {statusShort(deployment.status)}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-3 border-t-1.5 border-dashed border-rule/50 py-2 pl-6 pr-3">
        <a href={sign.url} target="_blank" rel="noopener noreferrer" className={cx("font-mono text-[11px] text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)}>
          {new URL(sign.url).host.replace(/^www\./u, "")} ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
        {sign.sentence ? (
          <ButtonLink to={intentHref(sign.sentence)} variant="ink" size="xs" title={`Plan: ${sign.sentence}`}>
            Plan a route →
          </ButtonLink>
        ) : sign.verbs.length > 0 ? (
          <span className="font-mono text-[10.5px] text-ink-3">{sign.verbs.slice(0, 3).join(" · ")}</span>
        ) : (
          <span className="font-mono text-[10.5px] text-ink-3">discovery only</span>
        )}
      </div>
    </li>
  );
}

/** The protocol registry as a trail board: filter by altitude, category and "Elyia routes here". */
export function TrailBoard() {
  const searchId = useId();
  const signs = useMemo(() => boardSigns(PROTOCOLS), []);
  const categories = useMemo(() => boardCategories(signs), [signs]);
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const shown = useMemo(() => filterBoard(signs, filter), [signs, filter]);
  const [expanded, setExpanded] = useState(false);
  const unfiltered = filter.altitude === "all" && filter.category === "all" && !filter.routable && filter.query.trim() === "";
  const visible = unfiltered && !expanded ? shown.slice(0, 9) : shown;
  const set = (patch: Partial<BoardFilter>) => setFilter((current) => ({ ...current, ...patch }));
  const counts = useMemo(() => ({ all: signs.length, summit: signs.filter((s) => s.altitude === "summit").length, ridge: signs.filter((s) => s.altitude === "ridge").length, floor: signs.filter((s) => s.altitude === "floor").length }), [signs]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 border-2 border-rule bg-paper-2 p-3 lg:flex-row lg:flex-wrap lg:items-center">
        <SegmentedControl
          size="sm"
          label="Altitude"
          value={filter.altitude}
          onChange={(altitude) => set({ altitude })}
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "summit", label: `Summit ${counts.summit}` },
            { value: "ridge", label: `Ridge ${counts.ridge}` },
            { value: "floor", label: `Floor ${counts.floor}` },
          ]}
        />
        <label className="flex h-8 items-stretch border-2 border-rule bg-card">
          <span className="flex items-center border-r-1.5 border-rule px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-2">Kind</span>
          <select value={filter.category} onChange={(event) => set({ category: event.target.value as BoardFilter["category"] })} className={cx("bg-transparent px-2 font-mono text-[12px] text-ink", FOCUS_RING)}>
            <option value="all">every kind</option>
            {categories.map(({ category, count }) => (
              <option key={category} value={category}>
                {category.replace("-", " ")} · {count}
              </option>
            ))}
          </select>
        </label>
        <Toggle checked={filter.routable} onChange={(routable) => set({ routable })} label="Elyia routes here" size="sm" />
        <div className="flex h-8 min-w-0 flex-1 items-stretch border-2 border-rule bg-card lg:max-w-[18rem] lg:ml-auto">
          <label htmlFor={searchId} className="sr-only">
            Search the registry
          </label>
          <input id={searchId} value={filter.query} onChange={(event) => set({ query: event.target.value })} placeholder="search · kinetiq, perps, bridge…" className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3" autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <p className="caption" aria-live="polite">
        {shown.length} of {signs.length} signs · summit first · open first
      </p>
      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-2 border-dashed border-rule/60 p-6">
          <p className="text-[15px] text-ink">No sign matches. The registry only lists what was checked; ask the Guide instead.</p>
          <button type="button" className={cx("font-mono text-[12px] text-ink underline decoration-accent-line decoration-2 underline-offset-4", FOCUS_RING)} onClick={() => setFilter(EMPTY_FILTER)}>
            clear the filters
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((sign) => (
            <Sign key={sign.id} sign={sign} />
          ))}
        </ul>
      )}
      {visible.length < shown.length ? (
        <button type="button" onClick={() => setExpanded(true)} className={cx("self-start border-2 border-rule bg-card px-4 py-2.5 font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-ink shadow-hard hover:-translate-x-px hover:-translate-y-px hover:shadow-hard-lg", FOCUS_RING)}>
          Show all {shown.length} signs ↓
        </button>
      ) : null}
    </div>
  );
}
