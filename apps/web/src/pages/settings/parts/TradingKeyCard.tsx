import { useState } from "react";

import { WalletButton } from "../../../app/shell/WalletButton";
import { daysLeft } from "../../../features/agentKey/approve";
import { useAgentStore } from "../../../features/agentKey/agentSession";
import type { AgentKeyApi } from "../../../features/agentKey/useAgentKey";
import { ElyEmpty } from "../../../pixel/ElyEmpty";
import { PixelGlyph } from "../../../pixel/PixelGlyph";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { Skeleton } from "../../../ui/Skeleton";
import { Toggle } from "../../../ui/Toggle";
import { ITEM } from "./kitItems";

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
    <div className="flex flex-col gap-8">
      <article className="relative bg-card px-frame px-drop-lg" aria-label="Trading key">
        <header className="flex flex-col items-center gap-2 border-b-2 border-rule bg-paper-2 px-4 py-3 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
          <h3 className="flex items-center gap-3 font-tag text-[12px] uppercase text-ink">
            <PixelGlyph rows={ITEM.key} scale={3} label={null} />
            elyia-web · trade-only key
          </h3>
          {phase ? (
            <span className={cx("flex items-center gap-1.5 font-tag text-[11px] uppercase", phase.tone)}>
              <span aria-hidden="true">{session.phase === "ready" ? "●" : "○"}</span>
              {phase.word}
            </span>
          ) : (
            <span className="font-tag text-[11px] uppercase text-ink-2">no wallet connected</span>
          )}
        </header>
        <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
          {!connected ? (
            <ElyEmpty compact title="No wallet connected" description="Connect the wallet you trade with. Your wallet key never leaves it; it signs one approval for this key." action={<WalletButton />} />
          ) : meta ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-[13px] sm:grid-cols-4">
                <div>
                  <dt className="font-tag text-[11px] uppercase text-ink-3">Key</dt>
                  <dd className="tnum font-semibold text-ink" title={meta.agentAddress}>
                    {short(meta.agentAddress)}
                  </dd>
                </div>
                <div>
                  <dt className="font-tag text-[11px] uppercase text-ink-3">For wallet</dt>
                  <dd className="tnum text-ink">{short(meta.master)}</dd>
                </div>
                <div>
                  <dt className="font-tag text-[11px] uppercase text-ink-3">On HyperCore</dt>
                  <dd className={health === "active" ? "text-up" : health === null ? "text-ink-2" : "text-down"}>{health === "active" ? "approved" : health === "expired" ? "expired" : health === "missing" ? "not listed" : "checking…"}</dd>
                </div>
                <div>
                  <dt className="font-tag text-[11px] uppercase text-ink-3">Expires</dt>
                  <dd className={cx("tnum", left < 3 ? "text-down" : "text-ink")}>
                    {date(meta.validUntil)} · {left} d
                  </dd>
                </div>
              </dl>
              <div>
                <ol className="flex gap-[6px]" aria-label={`${left} of ${total} days left`}>
                  {Array.from({ length: cells }, (_, index) => (
                    <li key={index} aria-hidden="true" className={cx("h-3 flex-1 px-frame-thin", index < usedCells ? "bg-ink" : "bg-paper")} />
                  ))}
                </ol>
                <p className="mt-2 flex justify-between font-tag text-[11px] uppercase text-ink-3">
                  <span>{date(meta.createdAt)}</span>
                  <span>{total > 30 ? `${total} days · one cell ≈ ${Math.round(total / 30)} d` : `${total} days`}</span>
                </p>
              </div>
            </>
          ) : (
            <p className="text-[15px] text-ink-2">{session.phase === "unsupported" || session.phase === "error" ? (session.error ?? "This browser cannot store the key safely.") : "No trading key on this device for this account. Enabling makes a fresh key here; your wallet approves it once."}</p>
          )}
          {connected ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
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
            <div className="flex flex-col gap-4 bg-paper-2 p-4 text-[14px] text-ink-2 px-frame-thin px-tone-down">
              <p>Revoking approves a throwaway address under the name elyia-web, which replaces this key on HyperCore at once. Your wallet signs once; then the key is deleted here.</p>
              <div className="flex gap-6">
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
        <footer className="flex flex-col items-center gap-1 border-t-2 border-dashed border-rule px-4 py-3 text-center font-mono text-[11px] text-ink-3 sm:flex-row sm:justify-between sm:px-6">
          <span>AES-GCM in this browser · never sent anywhere</span>
          <span className="font-tag uppercase text-down">Trade only · cannot withdraw</span>
        </footer>
      </article>

      <Toggle
        className="self-center"
        checked={oneClick}
        onChange={(on) => useAgentStore.getState().setOneClick(on)}
        disabled={session.phase !== "ready"}
        label="One-click trading"
        description="The ticket button signs at once instead of showing a review. Rule Book confirmations still ask. Off again when you leave."
      />

      {connected ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center justify-between font-tag text-[11px] uppercase text-ink-3">
            <span>Agents on this account</span>
            <span>{api.agents.length} / 3 named</span>
          </p>
          {api.agentsLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : api.agents.length === 0 ? (
            <p className="text-[14px] text-ink-2">No named agents yet.</p>
          ) : (
            <ul className="divide-y-2 divide-dashed divide-rule bg-card px-frame-thin">
              {api.agents.map((agent) => (
                <li key={agent.address} className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-[12px]">
                  <span className="min-w-0 truncate text-ink">
                    {agent.name || "(unnamed)"} <span className="text-ink-3">{short(agent.address)}</span>
                  </span>
                  <span className={cx("shrink-0 font-tag text-[11px] uppercase", agent.expired ? "text-down" : agent.thisDevice ? "text-up" : "text-ink-2")}>
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
