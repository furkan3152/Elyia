import { useMemo, useState } from "react";

import { HerdCard, HerdPortrait, RarityBadge } from "../../pixel/Herd";
import { herdLabel, herdMember, nextHerdId, TRAIT_LABELS } from "../../pixel/herd";
import { Cards, Section } from "../../pixel/layout";
import { Button } from "../../ui/Button";
import { ImportLine } from "./KeySection";

const IDS = [7, 42, 88, 128, 333, 512, 777, 1024] as const;

/** 04 · The Herd: seeded Ely NFTs on their layer's map. */
export function HerdSection() {
  const [id, setId] = useState(777);
  const member = useMemo(() => herdMember(id), [id]);
  return (
    <Section id="herd" tag="04 · NFT collection · The Herd" title="Every Ely is one of a kind, every background a map." lede="Fur, horns, eyes, mouth, gear and the elevation map of the layer it lives on. All generated in code: the same number always gives the same Ely.">
      <ImportLine>{'import { HerdCard, HerdPortrait, herdMember } from "src/pixel"'}</ImportLine>
      <div className="mx-auto flex max-w-[400px] flex-col items-center">
        <div className="w-full bg-card px-frame px-drop-lg">
          <HerdPortrait member={member} fluid />
        </div>
        <div className="mt-5 flex w-full items-center justify-between font-tag text-[13px] uppercase text-ink">
          <span className="tnum">{herdLabel(member.id)}</span>
          <RarityBadge rarity={member.rarity} />
        </div>
        <Button className="mt-7" onClick={() => setId((current) => nextHerdId(current))}>
          Draw another Ely
        </Button>
      </div>
      <Cards n={6} className="mt-12">
        {member.traits.map((trait) => (
          <div key={trait.key} className="flex h-full flex-col items-center justify-center bg-card px-2 py-3 text-center px-frame-thin">
            <span className="font-tag text-[11px] uppercase text-ink-2">{TRAIT_LABELS[trait.key]}</span>
            <span className="mt-1 font-display text-[17px] font-bold text-ink">{trait.name}</span>
            <span className="font-mono text-xs text-summit-ink">{Math.round(trait.share * 100)}% of the herd</span>
          </div>
        ))}
      </Cards>
      <Cards n={4} className="mt-14">
        {IDS.map((herdId) => (
          <HerdCard key={herdId} id={herdId} onSelect={setId} selected={herdId === id} />
        ))}
      </Cards>
    </Section>
  );
}
