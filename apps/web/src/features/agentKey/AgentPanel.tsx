import { KeyRound, Lock, LockOpen, MonitorSmartphone, RefreshCw, ShieldOff, Trash2, Zap } from "lucide-react";
import { useState } from "react";

import { shortAddress } from "../../lib/format";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Sheet } from "../../ui/Sheet";
import { Skeleton } from "../../ui/Skeleton";
import { Toggle } from "../../ui/Toggle";
import { daysLeft } from "./approve";
import { useAgentStore } from "./agentSession";
import type { AgentKeyApi } from "./useAgentKey";

export interface AgentPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly api: AgentKeyApi;
  readonly now: number;
  /** Opens the enable / renew flow. */
  readonly onEnable: () => void;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The trading key: status, expiry, lock, revoke, one-click, and every named agent on the account. */
export function AgentPanel({ open, onClose, api, now, onEnable }: AgentPanelProps) {
  const oneClick = useAgentStore((state) => state.oneClick);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [working, setWorking] = useState<"revoke" | "lock" | null>(null);
  const { session, health } = api;
  const meta = session.meta;
  const status =
    session.phase === "ready"
      ? { tone: "mint" as const, text: "unlocked" }
      : session.phase === "locked"
        ? { tone: "gold" as const, text: "locked" }
        : session.phase === "expired"
          ? { tone: "rose" as const, text: "expired: enable again" }
          : session.phase === "unsupported"
          ? { tone: "rose" as const, text: "not available here" }
          : session.phase === "loading"
            ? { tone: "neutral" as const, text: "opening vault" }
            : { tone: "neutral" as const, text: "not enabled" };

  const revoke = async () => {
    setWorking("revoke");
    const ok = await api.revoke();
    setWorking(null);
    if (ok) setConfirmRevoke(false);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Trading key" description="The trade-only elyia-web key that signs your HyperCore orders in this browser.">
      <div className="flex flex-col gap-5">
        <section className="rounded-2xl border border-line bg-bg-2/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-gold" aria-hidden="true" />
              <span className="font-mono text-sm text-text-0">elyia-web</span>
            </div>
            <Badge tone={status.tone} dot>
              {status.text}
            </Badge>
          </div>
          {meta ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-xs">
              <dt className="text-text-2">address</dt>
              <dd className="truncate text-text-1">{shortAddress(meta.agentAddress, 6, 6)}</dd>
              <dt className="text-text-2">expires</dt>
              <dd className={cx(daysLeft(meta.validUntil, now) < 3 ? "text-rose" : "text-text-1")}>
                {formatDate(meta.validUntil)} · {daysLeft(meta.validUntil, now)} days left
              </dd>
              <dt className="text-text-2">on HyperCore</dt>
              <dd className={health === "active" ? "text-mint" : health === null ? "text-text-2" : "text-rose"}>
                {health === "active" ? "approved" : health === "expired" ? "expired" : health === "missing" ? "not listed (revoked or replaced)" : "checking"}
              </dd>
              <dt className="text-text-2">stored</dt>
              <dd className="text-text-1">encrypted · {meta.deviceLabel}</dd>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-text-1">{session.error ?? "No trading key on this device for this account."}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {session.phase === "ready" ? (
              <Button
                size="sm"
                variant="outline"
                loading={working === "lock"}
                leftIcon={<Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={async () => {
                  setWorking("lock");
                  await api.lock();
                  setWorking(null);
                }}
              >
                Lock
              </Button>
            ) : null}
            {session.phase === "locked" ? (
              <Button size="sm" variant="gold" leftIcon={<LockOpen className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => void api.unlock()}>
                Unlock
              </Button>
            ) : null}
            {meta ? (
              <Button size="sm" variant="outline" leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onEnable}>
                Renew
              </Button>
            ) : (
              session.phase !== "unsupported" && (
                <Button size="sm" variant="gold" leftIcon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onEnable}>
                  Enable trading
                </Button>
              )
            )}
            {meta ? (
              <Button size="sm" variant="danger" leftIcon={<ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => setConfirmRevoke(true)}>
                Revoke
              </Button>
            ) : null}
          </div>
          {confirmRevoke ? (
            <div className="mt-3 rounded-xl border border-rose/35 bg-rose/[0.07] p-3 text-sm text-text-1">
              <p>
                Revoking approves a throwaway address under the name elyia-web, which replaces this key on HyperCore at once. Your wallet signs once; then the key is deleted here.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" loading={working === "revoke"} onClick={() => void revoke()}>
                  Sign revoke
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}
          {meta && health !== "active" && health !== null ? (
            <Button size="sm" variant="ghost" className="mt-2" leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => void api.forget()}>
              Forget it on this device
            </Button>
          ) : null}
          {api.progress.step === "error" && api.progress.error ? <p className="mt-2 text-xs text-rose">{api.progress.error}</p> : null}
        </section>

        <section className="flex flex-col gap-2">
          <Toggle
            checked={oneClick}
            onChange={(on) => useAgentStore.getState().setOneClick(on)}
            disabled={session.phase !== "ready"}
            label={
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
                One-click trading
              </span>
            }
            description="The ticket button signs at once instead of showing a review. Rule Book confirmations still ask. Off again when you leave."
          />
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="label-caps">Agents on this account</p>
            <span className="font-mono text-xs text-text-2">{api.agents.length} / 3 named</span>
          </div>
          {api.agentsLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : api.agents.length === 0 ? (
            <p className="text-sm text-text-2">No named agents yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--line)] rounded-2xl border border-line">
              {api.agents.map((agent) => (
                <li key={agent.address} className="flex items-center gap-3 px-3 py-2.5">
                  <MonitorSmartphone className={cx("h-4 w-4 shrink-0", agent.thisDevice ? "text-mint" : "text-text-2")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-text-0">
                      {agent.name || "(unnamed)"} <span className="text-text-2">{shortAddress(agent.address)}</span>
                    </p>
                    <p className="font-mono text-[11px] text-text-2">{agent.validUntil ? `until ${formatDate(agent.validUntil)}` : "no expiry"}</p>
                  </div>
                  {agent.thisDevice ? <Badge tone="mint">this device</Badge> : agent.isElyia ? <Badge tone="gold">another device</Badge> : <Badge tone="neutral">other app</Badge>}
                  {agent.expired ? <Badge tone="rose">expired</Badge> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs leading-relaxed text-text-2">HyperCore allows one unnamed and three named agents per account. Elyia uses the named slot elyia-web only, so the Hyperliquid app’s own session keeps working.</p>
        </section>
      </div>
    </Sheet>
  );
}
