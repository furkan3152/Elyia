import { useId, useMemo, useState } from "react";

import { intentHref } from "../../oracle/preview";
import { ElyEmpty } from "../../pixel/ElyEmpty";
import { Cards } from "../../pixel/layout";
import { ConditionSign } from "../../topo/ConditionSign";
import type { Layer } from "../../topo/geometry/relief";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Toggle } from "../../ui/Toggle";
import { BOARD_NETWORKS, BOARD_STATUSES, boardKinds, countBy, EMPTY_FILTER, filterBoard, networkShort, signNetworks, statusShort, type BoardFilter, type BoardNetwork, type BoardSign, type BoardStatus } from "./board";
import type { ProtocolLiveRow } from "@elyia/core/api/discovery";

const NETWORK_WORD: Readonly<Record<BoardNetwork, string>> = { "elysium-testnet": "Elysium testnet", "elysium-mainnet": "Elysium mainnet", hyperevm: "HyperEVM", hypercore: "HyperCore" };

function FilterSelect({ label, value, onChange, options, all }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly value: string; readonly label: string }[]; readonly all: string }) {
  return (
    <label className="flex h-8 items-stretch bg-card px-frame-thin">
      <span className="flex items-center bg-ink px-2 font-tag text-[10px] uppercase text-paper">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cx("bg-transparent px-2 font-mono text-[12px] text-ink", FOCUS_RING)}>
        <option value="all">{all}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const LAYER_BAR: Readonly<Record<Layer, string>> = { summit: "bg-summit", ridge: "bg-ridge", floor: "bg-floor" };
const LAYER_TEXT: Readonly<Record<Layer, string>> = { summit: "text-summit-ink", ridge: "text-ridge", floor: "text-floor" };
const LAYER_NAME: Readonly<Record<Layer, string>> = { summit: "Summit", ridge: "Ridge", floor: "Floor" };

const STATUS_WORD: Readonly<Record<BoardStatus, string>> = {
  "live-testnet": "live · testnet",
  "live-mainnet": "live · mainnet",
  announced: "announced",
  "prelaunch-mainnet": "pre-launch mainnet",
  unknown: "unknown",
  deprecated: "deprecated",
};

/** The live check's word for one protocol on the network it read: bytecode present, recent logs. */
function LiveBadge({ row }: { readonly row: ProtocolLiveRow | undefined }) {
  if (!row) return null;
  const gone = row.missing.length > 0;
  const text = row.active ? `● active · ${(row.recentLogs ?? 0).toLocaleString("en-US")} log${row.recentLogs === 1 ? "" : "s"}` : gone ? `✕ ${row.missing.length} contract${row.missing.length === 1 ? "" : "s"} gone` : row.present > 0 ? `○ deployed · quiet` : "? unread";
  return (
    <span title={`${row.present}/${row.contracts} contracts have bytecode now; ${row.recentLogs === null ? "logs not read" : `${row.recentLogs} logs in the window`}`} className={cx("px-2 py-0.5 font-tag text-[10px] uppercase px-frame-thin", row.active ? "bg-up text-paper" : gone ? "bg-down text-paper" : "bg-paper-2 text-ink-2")}>
      {text}
    </span>
  );
}

function Sign({ sign, live }: { readonly sign: BoardSign; readonly live?: ProtocolLiveRow }) {
  return (
    <li className="relative flex min-w-0 flex-col bg-card px-frame px-drop">
      <span aria-hidden="true" className={cx("h-2 w-full", LAYER_BAR[sign.altitude])} />
      <div className="flex flex-1 flex-col items-center gap-3 px-5 pb-4 pt-4 text-center">
        <p className={cx("font-tag text-[10px] uppercase", LAYER_TEXT[sign.altitude])}>
          {LAYER_NAME[sign.altitude]} · {sign.kind.replace("-", " ")} · {STATUS_WORD[sign.status]}
        </p>
        <h3 className="font-display text-[20px] font-bold leading-tight text-ink">{sign.name}</h3>
        {sign.executable || live ? (
          <span className="flex flex-wrap justify-center gap-2">
            {sign.executable ? <span className="bg-signal px-2 py-0.5 font-tag text-[10px] uppercase text-signal-ink px-frame-thin">Elyia routes</span> : null}
            <LiveBadge row={live} />
          </span>
        ) : null}
        <p className="line-clamp-3 text-[13.5px] leading-snug text-ink-2">{sign.description}</p>
        <ConditionSign condition={sign.condition} size="sm" />
        <p className="text-[12px] leading-snug text-ink-2">{sign.reason}</p>
        <ul className="mt-auto flex flex-wrap justify-center gap-2" aria-label="Deployments">
          {sign.deployments.map((deployment) => (
            <li key={`${deployment.network}-${deployment.status}`} className={cx("px-1.5 py-px font-mono text-[10.5px]", deployment.status === "live" || deployment.status === "testnet-live" ? "text-ink px-frame-thin" : "border-2 border-dashed border-rule text-ink-2")}>
              <span className={cx("font-semibold", LAYER_TEXT[deployment.layer])}>{networkShort(deployment.network)}</span> · {statusShort(deployment.status)}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-rule px-5 py-3">
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
export function TrailBoard({ signs, live }: { readonly signs: readonly BoardSign[]; readonly live: ReadonlyMap<string, ProtocolLiveRow> }) {
  const searchId = useId();
  const kinds = useMemo(() => boardKinds(signs), [signs]);
  const statusCounts = useMemo(() => countBy(signs, (sign) => sign.status), [signs]);
  const networkCounts = useMemo(() => countBy(signs, signNetworks), [signs]);
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const shown = useMemo(() => filterBoard(signs, filter), [signs, filter]);
  const [expanded, setExpanded] = useState(false);
  const unfiltered = filter.altitude === "all" && filter.kind === "all" && filter.status === "all" && filter.network === "all" && !filter.routable && filter.query.trim() === "";
  const visible = unfiltered && !expanded ? shown.slice(0, 9) : shown;
  const set = (patch: Partial<BoardFilter>) => setFilter((current) => ({ ...current, ...patch }));
  const counts = useMemo(() => ({ all: signs.length, summit: signs.filter((s) => s.altitude === "summit").length, ridge: signs.filter((s) => s.altitude === "ridge").length, floor: signs.filter((s) => s.altitude === "floor").length }), [signs]);

  return (
    <div className="flex flex-col gap-8">
      <div className="mx-auto flex w-full max-w-[1000px] flex-col items-center gap-4 bg-paper-2 p-4 px-frame-thin md:flex-row md:flex-wrap md:justify-center">
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
        <FilterSelect label="Kind" value={filter.kind} onChange={(kind) => set({ kind: kind as BoardFilter["kind"] })} options={kinds.map(({ kind, count }) => ({ value: kind, label: `${kind.replace("-", " ")} · ${count}` }))} all="every kind" />
        <FilterSelect label="Status" value={filter.status} onChange={(status) => set({ status: status as BoardFilter["status"] })} options={BOARD_STATUSES.filter((status) => statusCounts.has(status)).map((status) => ({ value: status, label: `${STATUS_WORD[status]} · ${statusCounts.get(status) ?? 0}` }))} all="any status" />
        <FilterSelect label="Network" value={filter.network} onChange={(network) => set({ network: network as BoardFilter["network"] })} options={BOARD_NETWORKS.map((network) => ({ value: network, label: `${NETWORK_WORD[network]} · ${networkCounts.get(network) ?? 0}` }))} all="every network" />
        <Toggle checked={filter.routable} onChange={(routable) => set({ routable })} label={`Executable · ${signs.filter((sign) => sign.executable).length}`} size="sm" />
        <div className="flex h-8 w-full min-w-0 items-stretch bg-card px-frame-thin md:w-[16rem]">
          <label htmlFor={searchId} className="sr-only">
            Search the registry
          </label>
          <input id={searchId} value={filter.query} onChange={(event) => set({ query: event.target.value })} placeholder="search · kinetiq, perps, bridge…" className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3" autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <ul className="mx-auto flex max-w-[1000px] flex-wrap justify-center gap-2" aria-label="Protocols per kind">
        {kinds.map(({ kind, count }) => (
          <li key={kind}>
            <button type="button" aria-pressed={filter.kind === kind} onClick={() => set({ kind: filter.kind === kind ? "all" : kind })} className={cx("px-btn px-btn-thin px-2 py-0.5 font-tag text-[11px] uppercase", filter.kind === kind ? "px-btn-signal text-signal-ink" : "px-btn-paper text-ink", FOCUS_RING)}>
              {kind.replace("-", " ")} <span className="tnum opacity-70">{count}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="caption text-center" aria-live="polite">
        {shown.length} of {signs.length} signs · summit first · open first
      </p>
      {shown.length === 0 ? (
        <ElyEmpty
          title="No sign matches"
          description="The registry only lists what was checked; ask the Guide instead."
          action={
            <button type="button" className={cx("px-btn px-btn-thin px-btn-paper px-4 py-2 font-tag text-[12px] uppercase text-ink", FOCUS_RING)} onClick={() => setFilter(EMPTY_FILTER)}>
              Clear the filters
            </button>
          }
        />
      ) : (
        <Cards n={3} as="ul">
          {visible.map((sign) => (
            <Sign key={sign.id} sign={sign} live={live.get(sign.id)} />
          ))}
        </Cards>
      )}
      {visible.length < shown.length ? (
        <button type="button" onClick={() => setExpanded(true)} className={cx("px-btn self-center px-btn-paper px-5 py-2.5 font-tag text-[13px] uppercase text-ink", FOCUS_RING)}>
          Show all {shown.length} signs ↓
        </button>
      ) : null}
    </div>
  );
}
