import { useMemo, useState } from "react";

import { HerdCard, HerdPortrait, RarityBadge } from "../../pixel/Herd";
import { HERD_SIZE, herdLabel, herdMember, nextHerdId } from "../../pixel/herd";
import { Section } from "../../pixel/layout";
import { PixelStamp } from "../../pixel/PixelStamp";
import { Button } from "../../ui/Button";

const LEFT = [42, 333] as const;
const RIGHT = [512, 1024] as const;

function Flank({ ids, onSelect, selected }: { readonly ids: readonly number[]; readonly onSelect: (id: number) => void; readonly selected: number }) {
  return (
    <div className="grid h-full min-w-0 grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-1 md:content-between">
      {ids.map((id) => (
        <HerdCard key={id} id={id} onSelect={onSelect} selected={selected === id} />
      ))}
    </div>
  );
}

/**
 * The Herd, coming soon: a mirrored line-up of seeded Elys on their layers'
 * maps, the chosen one in the middle. Every portrait is generated in the
 * browser from its number; nothing is minted or for sale yet.
 */
export function HerdTeaser() {
  const [id, setId] = useState(777);
  const member = useMemo(() => herdMember(id), [id]);
  return (
    <Section
      id="herd"
      tag="The Herd · NFT collection · soon"
      title="Every Ely is one of a kind."
      lede={`Fur, horns, eyes, mouth, beard, headwear, neck, accessory and the elevation map it lives on, generated in code: the same number always draws the same Ely. ${HERD_SIZE.toLocaleString("en-US")} of them, fifteen hand-made 1/1s among them. Nothing is minted or on sale yet.`}
    >
      <div className="mx-auto grid max-w-[1000px] grid-cols-1 items-stretch gap-x-6 gap-y-7 md:grid-cols-[minmax(0,1fr)_minmax(0,2.3fr)_minmax(0,1fr)]">
        <div className="order-2 md:order-1">
          <Flank ids={LEFT} onSelect={setId} selected={id} />
        </div>
        <figure className="relative order-1 m-0 flex flex-col bg-card px-frame px-drop-lg md:order-2">
          <div className="flex flex-1 items-center justify-center" style={{ background: member.backdrop }}>
            <HerdPortrait member={member} fluid className="w-full" />
          </div>
          <figcaption className="flex items-center justify-between gap-3 px-4 py-3 font-tag text-[12px] uppercase text-ink">
            <span className="tnum">{herdLabel(member.id)}</span>
            <span className="hidden truncate text-ink-2 sm:block">
              {member.traits
                .filter((trait) => trait.key === "fur" || trait.key === "headwear" || trait.key === "legendary")
                .map((trait) => `${trait.label} ${trait.name}`)
                .join(" · ")}
            </span>
            <RarityBadge rarity={member.rarity} />
          </figcaption>
          <PixelStamp state="queued" text="Coming soon" size="md" rotate={-8} className="absolute -right-4 -top-5 bg-card" label="Coming soon" />
        </figure>
        <div className="order-3">
          <Flank ids={RIGHT} onSelect={setId} selected={id} />
        </div>
      </div>
      <div className="mt-10 flex justify-center">
        <Button variant="primary" size="lg" onClick={() => setId((current) => nextHerdId(current))}>
          Draw another Ely
        </Button>
      </div>
    </Section>
  );
}
