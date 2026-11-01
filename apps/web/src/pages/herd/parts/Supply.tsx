import type { HerdConfigResponse } from "@elyia/core/api/herd";

import { timeline } from "../../../features/herd/herdModel";
import { cx } from "../../../ui/cx";
import { BlockBar } from "./ui";

/** Allocations (live from chain, or the planned defaults, labelled) and the phase timeline. */
export function Supply({ config }: { readonly config: HerdConfigResponse | null | undefined }) {
  const a = config?.allocations;
  const planned = !a;
  const rows = a
    ? [
        { label: "WL", cap: a.wl, minted: a.wlMinted },
        { label: "Collab", cap: a.collab, minted: a.collabMinted },
        { label: "Public", cap: a.public, minted: a.publicMinted },
        { label: "Team reserve", cap: a.team, minted: a.teamMinted },
      ]
    : [
        { label: "WL + collab", cap: config?.defaults.wlAndCollab ?? 1611, minted: 0 },
        { label: "Public", cap: config?.defaults.public ?? 1611, minted: 0 },
        { label: "Team reserve", cap: config?.defaults.team ?? 111, minted: 0 },
      ];
  const stops = timeline(config);
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-3 bg-card p-5 px-frame">
        <h3 className="flex items-center justify-between font-display text-[18px] font-bold text-ink">
          Supply <span className="font-tag text-[10px] font-normal uppercase text-ink-3">{planned ? "planned · not on chain yet" : "live from the contract"}</span>
        </h3>
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1">
            <div className="flex justify-between text-[12.5px]">
              <span className="text-ink">{row.label}</span>
              <span className="font-mono text-ink-2 tnum">
                {row.minted.toLocaleString("en-US")} / {row.cap.toLocaleString("en-US")}
              </span>
            </div>
            <BlockBar fraction={row.cap > 0 ? row.minted / row.cap : 0} blocks={24} tone="up" label={`${row.label}: ${row.minted} of ${row.cap}`} />
          </div>
        ))}
        <p className="text-[11.5px] text-ink-3">3,333 in total, 1 per wallet. Unused WL/collab supply rolls into public, and unsold public into the team reserve or a burn, only by an explicit owner transaction.</p>
      </div>
      <div className="flex flex-col gap-3 bg-card p-5 px-frame">
        <h3 className="font-display text-[18px] font-bold text-ink">Phases</h3>
        <ol className="m-0 flex list-none flex-col p-0">
          {stops.map((stop, index) => (
            <li key={stop.phase} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span aria-hidden="true" className={cx("mt-1 h-3 w-3", stop.state === "now" ? "bg-accent" : stop.state === "done" ? "bg-up" : "bg-paper-3")} />
                {index < stops.length - 1 ? <span aria-hidden="true" className="w-[2px] flex-1 bg-rule" /> : null}
              </div>
              <div className="pb-3">
                <b className="font-display text-[15px] text-ink">
                  {stop.label} <span className="font-tag text-[10px] font-normal uppercase text-ink-3">{stop.state === "now" ? "· now" : stop.state === "done" ? "· done" : ""}</span>
                </b>
                <p className="text-[12px] text-ink-2">
                  {stop.start ? `${new Date(stop.start).toUTCString().slice(5, 22)} → ${stop.end ? new Date(stop.end).toUTCString().slice(5, 22) : "?"} UTC` : stop.phase === "wl" || stop.phase === "public" ? "Not scheduled yet" : stop.phase === "closed" ? "Before the mint" : "After the mint: reveal"}
                  {stop.price ? ` · ${stop.price}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
