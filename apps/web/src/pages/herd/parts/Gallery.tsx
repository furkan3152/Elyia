import { useMemo, useState } from "react";

import { HerdCard, HerdPortrait, RarityBadge } from "../../../pixel/Herd";
import { HERD_SIZE, herdMember } from "../../../pixel/herd";
import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Chip } from "./ui";

const PAGE = 12;

/** Browse the art: every goat drawn in the browser by the same code as the PNGs. */
export function Gallery() {
  const [start, setStart] = useState(1);
  const [selected, setSelected] = useState(777);
  const [query, setQuery] = useState("");
  const ids = useMemo(() => Array.from({ length: PAGE }, (_, index) => ((start - 1 + index) % HERD_SIZE) + 1), [start]);
  const member = useMemo(() => herdMember(selected), [selected]);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="font-tag text-[10px] uppercase text-ink-2">Go to #</span>
            <input
              inputMode="numeric"
              value={query}
              onChange={(event) => setQuery(event.target.value.replace(/\D/gu, "").slice(0, 4))}
              onKeyDown={(event) => {
                const id = Number(query);
                if (event.key === "Enter" && id >= 1 && id <= HERD_SIZE) {
                  setSelected(id);
                  setStart(Math.floor((id - 1) / PAGE) * PAGE + 1);
                }
              }}
              className={cx("h-9 w-24 bg-paper px-2 font-mono text-[13px] text-ink px-frame-thin", FOCUS_RING)}
              aria-label={`Herd number, 1 to ${HERD_SIZE}`}
            />
          </label>
          <Button variant="ink" size="sm" onClick={() => setStart((value) => ((value - 1 - PAGE + HERD_SIZE) % HERD_SIZE) + 1)}>
            ← Prev
          </Button>
          <Button variant="ink" size="sm" onClick={() => setStart((value) => ((value - 1 + PAGE) % HERD_SIZE) + 1)}>
            Next →
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStart(Math.floor(Math.random() * HERD_SIZE) + 1)}>
            Shuffle
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {ids.map((id) => (
            <HerdCard key={id} id={id} onSelect={setSelected} selected={id === selected} />
          ))}
        </div>
      </div>
      <figure className="m-0 flex flex-col bg-card px-frame px-drop-lg">
        <div style={{ background: member.backdrop }}>
          <HerdPortrait member={member} fluid className="w-full" />
        </div>
        <figcaption className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <b className="font-display text-[22px] text-ink">{member.name}</b>
            <RarityBadge rarity={member.rarity} />
          </div>
          <span className="font-tag text-[10.5px] uppercase text-ink-3">Rank {member.rank.toLocaleString("en-US")} of {HERD_SIZE.toLocaleString("en-US")} · score {member.score.toFixed(0)}</span>
          {member.legend ? <p className="text-[13px] text-ink-2">{member.legend.story}</p> : null}
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 text-[12.5px]">
            {member.traits.map((trait) => (
              <li key={trait.key} className="flex justify-between gap-2 border-b border-dashed border-rule py-1">
                <span className="text-ink-3">{trait.label}</span>
                <span className="text-right text-ink">
                  {trait.name} <span className="text-ink-3 tnum">{(trait.share * 100).toFixed(1)}%</span>
                </span>
              </li>
            ))}
          </ul>
          <Chip tone="mute" className="self-start">Preview art · which goat a token shows is fixed at reveal</Chip>
        </figcaption>
      </figure>
    </div>
  );
}
