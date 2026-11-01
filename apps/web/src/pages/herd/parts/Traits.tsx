import { useMemo, useState } from "react";

import { herdTraits, RARITY_FILL, RARITY_LABEL } from "../../../pixel/herd";
import { Button } from "../../../ui/Button";

/** Every trait, every option: how many goats carry it and how rare it is. */
export function Traits() {
  const categories = useMemo(() => herdTraits(), []);
  const [all, setAll] = useState(false);
  const shown = all ? categories : categories.slice(0, 3);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {shown.map((category) => (
          <div key={category.key} className="bg-card p-4 px-frame">
            <h3 className="font-display text-[17px] font-bold text-ink">{category.label}</h3>
            <ul className="m-0 mt-2 list-none p-0">
              {category.options.map((option) => (
                <li key={option.name} className="flex items-center gap-2 border-b border-dashed border-rule py-1 text-[12.5px] last:border-b-0">
                  <span aria-hidden="true" className="inline-block h-[8px] w-[8px] shrink-0" style={{ background: RARITY_FILL[option.tier] ?? "var(--rule-strong)" }} />
                  <span className="min-w-0 flex-1 truncate text-ink">{option.name}</span>
                  <span className="text-ink-3 tnum">{option.count}</span>
                  <span className="w-12 text-right text-ink-2 tnum">{(option.share * 100).toFixed(1)}%</span>
                  <span className="hidden w-16 text-right font-tag text-[9.5px] uppercase text-ink-3 sm:inline">{RARITY_LABEL[option.tier]}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {categories.length > 3 ? (
        <div className="flex justify-center">
          <Button variant="ink" onClick={() => setAll((value) => !value)} aria-expanded={all}>
            {all ? "Show fewer traits" : `Show all ${categories.length} traits`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
