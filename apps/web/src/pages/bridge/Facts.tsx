import { getEvmNetwork, layersFor, type NetworkEnvironment } from "@elyia/core/networks";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { cx } from "../../ui/cx";
import { ROLLUP_PERIOD_ABI } from "../track/flow/abis";
import { withdrawalSeconds } from "../track/flow/orbit";
import { formatEta } from "../track/flow/routeModel";
import { MAINNET_CONFIRM_BLOCKS, TICKET_SURVEY } from "./lanes";

/**
 * The ticket watch: why Elyia follows every ERC-20 ascent. Six small ticket
 * stubs are the six live testnet retryables surveyed; five carry the
 * "redeemed by hand" stamp. The lifecycle below is what Elyia checks.
 */
export function TicketWatch({ className }: { readonly className?: string }) {
  const stages = [
    ["Created", "the ticket lands on Elysium"],
    ["Auto-redeem", "usually fails on the practice wall"],
    ["Redeem", "one tap, one signature, before 7 days"],
    ["On the summit", "tokens credited"],
  ] as const;
  return (
    <section className={cx("border-2 border-rule bg-card shadow-hard", className)} aria-labelledby="ticket-watch">
      <header className="flex items-center justify-between gap-3 border-b-2 border-rule bg-ink px-4 py-2.5 text-paper">
        <h2 id="ticket-watch" className="font-sans text-[15px] font-bold uppercase tracking-[0.06em]">
          Ticket watch
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] opacity-80">retryable · 7-day life</span>
      </header>
      <div className="p-4">
        <ol className="flex gap-1.5" aria-label={`${TICKET_SURVEY.manual} of ${TICKET_SURVEY.tickets} surveyed tickets needed a manual redeem`}>
          {Array.from({ length: TICKET_SURVEY.tickets }, (_, index) => {
            const manual = index < TICKET_SURVEY.manual;
            return (
              <li key={index} className={cx("relative flex h-14 flex-1 flex-col items-center justify-center border-2 border-rule font-mono text-[10px] font-semibold", manual ? "bg-paper-2 text-ink" : "bg-card text-ink")} aria-hidden="true">
                <span className="absolute inset-x-0 top-3 border-t-1.5 border-dashed border-rule/50" />
                <span className="tnum mt-3">#{index + 1}</span>
                <span className={cx("mt-0.5", manual ? "-rotate-6 border-1.5 border-down px-1 text-[9px] text-down" : "text-up")}>{manual ? "BY HAND" : "AUTO ✓"}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[15px] leading-snug text-ink">
          <span className="font-bold">
            {TICKET_SURVEY.manual} of {TICKET_SURVEY.tickets}
          </span>{" "}
          live testnet tickets needed a manual redeem. Elyia computes your ticket id from the deposit, watches it, and if it stalls asks you once: one tap, one signature.
        </p>
        <ol className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          {stages.map(([title, body], index) => (
            <li key={title} className="border-l-2 border-rule pl-2.5">
              <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
                {index + 1} · {title}
              </span>
              <span className="block text-[12.5px] leading-snug text-ink-2">{body}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * The descent clock: how long the trail down takes, read from the rollup
 * itself (`confirmPeriodBlocks()` on HyperEVM) for the practice wall, next
 * to the mainnet value Elyia pins (483,840 blocks).
 */
export function DescentClock({ mode, className }: { readonly mode: NetworkEnvironment; readonly className?: string }) {
  const elysium = getEvmNetwork(layersFor(mode).elysium.key);
  const parent = getEvmNetwork(layersFor(mode).hyperevm.key);
  const rollup = elysium.elysiumBridge?.parent.rollup as Address | undefined;
  const period = useReadContract({ address: rollup, abi: ROLLUP_PERIOD_ABI, functionName: "confirmPeriodBlocks", chainId: parent.chainId, query: { enabled: Boolean(rollup), staleTime: 10 * 60_000 } });
  const live = period.data !== undefined ? Number(period.data) : null;
  const pinned = elysium.elysiumBridge?.confirmPeriodBlocks ?? null;
  const blocks = live ?? pinned;
  const rows = [
    { label: "Practice wall", sub: `${blocks?.toLocaleString("en-US") ?? "—"} blocks${live !== null ? " · read live" : " · pinned"}`, value: blocks !== null ? formatEta(withdrawalSeconds(blocks)) : "—", strong: mode === "testnet" },
    { label: "Mainnet", sub: `${MAINNET_CONFIRM_BLOCKS.toLocaleString("en-US")} blocks · pinned`, value: formatEta(withdrawalSeconds(MAINNET_CONFIRM_BLOCKS)), strong: mode === "mainnet" },
  ];
  return (
    <section className={cx("border-2 border-rule bg-card p-4 shadow-hard", className)} aria-labelledby="descent-clock">
      <p className="caption">Descent clock · the challenge period</p>
      <h2 id="descent-clock" className="mt-1.5 text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">
        Up by cable car. Down on foot.
      </h2>
      <p className="mt-1.5 text-[14px] leading-snug text-ink-2">Deposits reach the Summit in minutes. A withdrawal waits for the rollup to confirm, then you claim it at the Ridge hut.</p>
      <dl className="mt-4 flex flex-col divide-y divide-rule/20 border-y-2 border-rule">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-2.5">
            <dt>
              <span className="block text-[15px] font-semibold text-ink">{row.label}</span>
              <span className="tnum block font-mono text-[11px] text-ink-3">{row.sub}</span>
            </dt>
            <dd className={cx("tnum font-mono font-semibold text-ink", row.strong ? "text-[26px]" : "text-[19px]")}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 font-mono text-[11px] text-ink-3">+ ~30 min assertion cadence · claim needs one signature on HyperEVM</p>
    </section>
  );
}
