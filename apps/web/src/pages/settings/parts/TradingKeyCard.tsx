import { useState } from "react";

import { WalletButton } from "../../../app/shell/WalletButton";
import { daysLeft } from "../../../features/agentKey/approve";
import { useAgentStore } from "../../../features/agentKey/agentSession";
import type { AgentKeyApi } from "../../../features/agentKey/useAgentKey";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Skeleton } from "../../../ui/Skeleton";
import { Toggle } from "../../../ui/Toggle";

const DAY = 86_400_000;

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function date(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const PHASE: Readonly<Record<string, { readonly word: string; readonly tone: string }>> = {
  ready: { word: "unlocked · signs on your click", tone: "text-up" },
  locked: { word: "locked on this device", tone: "text-warn-ink" },
  expired: { word: "expired · enable again", tone: "text-down" },
  none: { word: "not enabled", tone: "text-ink-2" },
  loading: { word: "opening the vault…", tone: "text-ink-2" },
  unsupported: { word: "not available in this browser", tone: "text-down" },
  error: { word: "the vault failed", tone: "text-down" },
};

/**
 * The trading key (elyia-web): a trade-only HyperCore agent key born in this
 * browser, stored encrypted, approved once by your wallet. Drawn as a key
 * tag: address, expiry as a strip of days, HyperCore's own view, and the
 * lock / unlock / renew / revoke controls. It can trade, never withdraw.
 */
export function TradingKeyCard({ api, connected, now, onEnable }: { readonly api: AgentKeyApi; readonly connected: string | null; readonly now: number; readonly onEnable: () => void }) {
  const oneClick = useAgentStore((state) => state.oneClick);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [working, setWorking] = useState<"lock" | "unlock" | "revoke" | null>(null);
  const { session, health } = api;
  const meta = session.meta;
  const phase = connected ? PHASE[session.phase] ?? PHASE.none! : null;
  const left = meta ? daysLeft(meta.validUntil, now) : 0;
  const total = meta ? Math.max(1, Math.round((meta.validUntil - meta.createdAt) / DAY)) : 30;
  const cells = Math.min(30, total);
  const usedCells = meta ? Math.round(((total - left) / total) * cells) : 0;

  const run = async (kind: "lock" | "unlock" | "revoke", task: () => Promise<unknown>) => {
    setWorking(kind);
    try {
      await task();
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <article className="relative border-2 border-rule bg-card shadow-hard-lg" aria-label="Trading key">
        <span aria-hidden="true" className="absolute -left-[13px] top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-2 border-rule bg-paper" />
        <header className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-dashed border-rule py-2 pl-6 pr-4">
          <h3 className="font-mono text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">elyia-web · trade-only key</h3>
          {phase ? (
            <span className={cx("flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]", phase.tone)}>
              <span aria-hidden="true">{session.phase === "ready" ? "●" : "○"}</span>
              {phase.word}
            </span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2">no wallet connected</span>
          )}
        </header>
        <div className="flex flex-col gap-4 py-4 pl-6 pr-4">
          {!connected ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[15px] text-ink-2">Connect the wallet you trade with. Your wallet key never leaves it; it signs one approval for this key.</p>
              <WalletButton />
            </div>
          ) : meta ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-[13px] sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Key</dt>
                  <dd className="tnum font-semibold text-ink" title={meta.agentAddress}>
                    {short(meta.agentAddress)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">For wallet</dt>
                  <dd className="tnum text-ink">{short(meta.master)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">On HyperCore</dt>
                  <dd className={health === "active" ? "text-up" : health === null ? "text-ink-2" : "text-down"}>{health === "active" ? "approved" : health === "expired" ? "expired" : health === "missing" ? "not listed" : "checking…"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-3">Expires</dt>
                  <dd className={cx("tnum", left < 3 ? "text-down" : "text-ink")}>
                    {date(meta.validUntil)} · {left} d
                  </dd>
                </div>
              </dl>
              <div>
                <ol className="flex gap-[3px]" aria-label={`${left} of ${total} days left`}>
                  {Array.from({ length: cells }, (_, index) => (
                    <li key={index} aria-hidden="true" className={cx("h-3 flex-1 border-1.5 border-rule", index < usedCells ? "bg-ink" : "bg-paper")} />
                  ))}
                </ol>
                <p className="mt-1 flex justify-between font-mono text-[11px] text-ink-3">
                  <span>{date(meta.createdAt)}</span>
                  <span>{total > 30 ? `${total} days · one cell ≈ ${Math.round(total / 30)} d` : `${total} days`}</span>
                </p>
              </div>
            </>
          ) : (
            <p className="text-[15px] text-ink-2">{session.phase === "unsupported" || session.phase === "error" ? (session.error ?? "This browser cannot store the key safely.") : "No trading key on this device for this account. Enabling makes a fresh key here; your wallet approves it once."}</p>
          )}
          {connected ? (
            <div className="flex flex-wrap items-center gap-2">
              {session.phase === "ready" ? (
                <Button variant="ink" size="sm" loading={working === "lock"} onClick={() => void run("lock", () => api.lock())}>
                  Lock
                </Button>
              ) : null}
              {session.phase === "locked" ? (
                <Button variant="primary" size="sm" loading={working === "unlock"} onClick={() => void run("unlock", () => api.unlock())}>
                  Unlock
                </Button>
              ) : null}
              {session.phase !== "unsupported" && session.phase !== "loading" ? (
                <Button variant={meta ? "ink" : "primary"} size="sm" onClick={onEnable}>
                  {meta ? "Renew" : "Enable trading"}
                </Button>
              ) : null}
              {meta ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmRevoke(true)}>
                  Revoke
                </Button>
              ) : null}
              {meta && health !== null && health !== "active" ? (
                <Button variant="ghost" size="sm" onClick={() => void api.forget()}>
                  Forget it here
                </Button>
              ) : null}
            </div>
          ) : null}
          {confirmRevoke ? (
            <div className="flex flex-col gap-2 border-l-[3px] border-down bg-paper-2 p-3 text-[14px] text-ink-2">
              <p>Revoking approves a throwaway address under the name elyia-web, which replaces this key on HyperCore at once. Your wallet signs once; then the key is deleted here.</p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" loading={working === "revoke"} onClick={() => void run("revoke", async () => (await api.revoke()) && setConfirmRevoke(false))}>
                  Sign revoke
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}
          {api.progress.step === "error" && api.progress.error ? <p className="text-[13px] text-down">{api.progress.error}</p> : null}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t-1.5 border-rule/30 py-2 pl-6 pr-4 font-mono text-[11px] text-ink-3">
          <span>AES-GCM in this browser · never sent anywhere</span>
          <span className="font-semibold uppercase tracking-[0.1em] text-down">Trade only · cannot withdraw</span>
        </footer>
      </article>

      <Toggle
        checked={oneClick}
        onChange={(on) => useAgentStore.getState().setOneClick(on)}
        disabled={session.phase !== "ready"}
        label="One-click trading"
        description="The ticket button signs at once instead of showing a review. Rule Book confirmations still ask. Off again when you leave."
      />

      {connected ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            <span>Agents on this account</span>
            <span>{api.agents.length} / 3 named</span>
          </p>
          {api.agentsLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : api.agents.length === 0 ? (
            <p className="text-[14px] text-ink-2">No named agents yet.</p>
          ) : (
            <ul className="divide-y divide-rule/15 border-2 border-rule bg-card">
              {api.agents.map((agent) => (
                <li key={agent.address} className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-[12px]">
                  <span className="min-w-0 truncate text-ink">
                    {agent.name || "(unnamed)"} <span className="text-ink-3">{short(agent.address)}</span>
                  </span>
                  <span className={cx("shrink-0 uppercase tracking-[0.08em]", agent.expired ? "text-down" : agent.thisDevice ? "text-up" : "text-ink-2")}>
                    {agent.expired ? "expired" : agent.thisDevice ? "this device" : agent.isElyia ? "another device" : "other app"}
                    {agent.validUntil ? ` · ${date(agent.validUntil)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] leading-relaxed text-ink-3">HyperCore allows one unnamed and three named agents per account. Elyia uses the named slot elyia-web only, so the Hyperliquid app&apos;s own session keeps working.</p>
        </div>
      ) : null}
    </div>
  );
}
