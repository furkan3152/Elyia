import type { HerdConfigResponse } from "@elyia/core/api/herd";

import { artOfToken } from "../../../features/herd/art";
import { useHolder } from "../../../features/herd/herdApi";
import { HerdPortrait } from "../../../pixel/Herd";
import { ButtonLink } from "../../../ui/Button";
import { Chip } from "./ui";

/** The connected wallet's goats (ids from the indexer, balance from chain) and its perks. */
export function YourGoat({ address, config }: { readonly address: string; readonly config: HerdConfigResponse | null | undefined }) {
  const holder = useHolder(address);
  const ids = holder.data?.tokenIds ?? [];
  const perks = holder.data?.perks;
  if (!holder.data) return <p className="text-center text-[13px] text-ink-3">{holder.isError ? "Could not read your goats right now." : "Reading your wallet…"}</p>;
  if (holder.data.balance === 0) {
    return (
      <div className="mx-auto flex max-w-[620px] flex-col items-center gap-4 text-center">
        <div className="w-28">
          <HerdPortrait id={0} fluid label="An unrevealed Ely in the fog" />
        </div>
        <p className="text-[14px] text-ink-2">No goat in this wallet yet. Mint one above, or join the WL first.</p>
        <ButtonLink to="/herd/wl" variant="ink">Apply for the WL</ButtonLink>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex flex-wrap justify-center gap-5">
        {(ids.length > 0 ? ids : [0]).slice(0, 6).map((id) => {
          const art = id === 0 ? 0 : artOfToken(id, config);
          return (
            <figure key={id} className="m-0 w-40 bg-card px-frame px-drop">
              <HerdPortrait id={art} fluid label={art === 0 ? `Your Ely #${id}, unrevealed` : undefined} />
              <figcaption className="flex items-center justify-between px-3 py-2 font-tag text-[11px] uppercase text-ink">
                <span>{id === 0 ? "indexing…" : `Token #${id}`}</span>
                {art === 0 ? <Chip tone="mute">unrevealed</Chip> : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Chip tone="up">Herd holder · {holder.data.balance}</Chip>
        {perks ? <Chip tone="acc">chat {perks.agentChatPerDay}/day · automations {perks.automations} · alerts {perks.alerts}</Chip> : null}
      </div>
      <p className="text-[12px] text-ink-3">{config?.reveal.revealed ? "Revealed: this is your goat's art." : "Until the reveal, every goat waits in the fog. Your Ely across Elyia switches to the art once it is revealed."}</p>
    </div>
  );
}
