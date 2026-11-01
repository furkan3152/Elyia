import { HERD_BASE_PERKS, HERD_HOLDER_PERKS } from "@elyia/core/api/herd";

import { Cards } from "../../../pixel/layout";
import { HerdPortrait } from "../../../pixel/Herd";

const UTILITIES = [
  { id: 412, title: "Your goat is your Ely", body: "Hold one and it becomes the Ely you talk to: the Ask Ely rail, the portfolio's Ely panel and, soon, Telegram." },
  { id: 1203, title: "Holder badge", body: "A Herd badge next to your wallet across Elyia. Checked on chain (balanceOf), never taken from your browser." },
  { id: 2718, title: "Herd perks", body: `Agent chat ${HERD_BASE_PERKS.agentChatPerDay} → ${HERD_HOLDER_PERKS.agentChatPerDay} turns/day · automations ${HERD_BASE_PERKS.automations} → ${HERD_HOLDER_PERKS.automations} · alerts ${HERD_BASE_PERKS.alerts} → ${HERD_HOLDER_PERKS.alerts} · developer API quota ×${HERD_HOLDER_PERKS.developerQuotaMultiplier} · keeper priority · early access to flagged features.` },
  { id: 99, title: "Testnet → mainnet WL", body: "Every testnet WL-approved wallet and every testnet minter is snapshotted into the mainnet allowlist." },
] as const;

/** What holding one does on Elyia. Platform perks only: no promise of returns, revenue or price. */
export function Utilities() {
  return (
    <>
      <Cards n={4}>
        {UTILITIES.map((item) => (
          <article key={item.title} className="flex h-full flex-col gap-3 bg-card p-4 px-frame">
            <div className="w-16">
              <HerdPortrait id={item.id} scale={1} fluid label={null} />
            </div>
            <h3 className="font-display text-[18px] font-bold leading-tight text-ink">{item.title}</h3>
            <p className="text-[13px] leading-relaxed text-ink-2">{item.body}</p>
          </article>
        ))}
      </Cards>
      <p className="mx-auto mt-6 max-w-[640px] text-center text-[12px] text-ink-3">The Herd is a collectible with platform perks. It is not an investment: no returns, revenue share or price is promised, and perks can change.</p>
    </>
  );
}
