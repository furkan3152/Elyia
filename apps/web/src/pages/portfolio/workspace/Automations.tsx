import { DEFAULT_KEEPER_LIMITS, type Automation, type AutomationKind } from "@elyia/core/api/agent";
import { useState } from "react";

import { useAutomations, useKeeperStatus, useSkills, useSwitchAutomation } from "../../../features/ely/agentApi";
import { useKeeperFlow } from "../../../features/ely/keeper";
import { Glyph, Toggle } from "../../../features/ely/ui";
import type { WalletSession } from "../../../features/session/useWalletSession";
import { describeError } from "../../../lib/api";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Dialog } from "../../../ui/Dialog";

interface AutomationItem {
  readonly kind: AutomationKind;
  readonly title: string;
  readonly body: string;
  /** The cap line. */
  readonly cap: string;
}

/** The kinds Ely runs today; each run only drafts proposals the owner signs. */
const AUTOMATIONS: readonly AutomationItem[] = [
  { kind: "auto-protect", title: "Auto-protect", body: "Drafts a stop and a target for every open position that has none.", cap: "drafts TP / SL" },
  { kind: "liquidation-guard", title: "Liquidation guard", body: "Drafts a reduce-only trim when a rope falls under 10% from liquidation.", cap: "under 10% rope" },
  { kind: "rebalance", title: "Rebalance", body: "Drafts the route back to your target mix when you drift past your band.", cap: "your target mix" },
  { kind: "idle-sweep", title: "Idle sweeper", body: "Drafts a deposit of idle stablecoins into the verified vault, keeping a buffer.", cap: "keeps 10% buffer" },
  { kind: "gas-top-up", title: "Gas at camps", body: "Drafts a HYPE top-up for gas on a layer before a route needs it.", cap: "min 0.2 HYPE" },
];

export interface AutomationsProps {
  readonly session: WalletSession;
  readonly own: boolean;
  /** The labelled sample is on screen (nobody's automations). */
  readonly sample: boolean;
  readonly open: boolean;
  readonly onToggleOpen: () => void;
}

/**
 * Automations in the Ely panel: a one-line summary that opens into a compact
 * list of switches with their caps, and Autopilot (the keeper's caps, signed
 * once in the wallet). Every automation runs inside a policy and only drafts
 * proposals the owner signs. Switching needs a wallet session (a sign-in
 * message, not a transaction).
 */
export function Automations({ session, own, sample, open, onToggleOpen }: AutomationsProps) {
  const token = own ? session.token : null;
  const automations = useAutomations(token);
  const skills = useSkills();
  const keeper = useKeeperStatus(token);
  const toggle = useSwitchAutomation(token);
  const [problem, setProblem] = useState<string | null>(null);
  const [capsOpen, setCapsOpen] = useState(false);
  const list = automations.data?.automations ?? [];
  const byKind = (kind: AutomationKind): Automation | null => list.find((entry) => entry.kind === kind) ?? null;
  const on = list.filter((entry) => entry.enabled).length;
  const keeperOn = keeper.data?.state === "active";

  const onSwitch = async (kind: AutomationKind, next: boolean) => {
    setProblem(null);
    let use = token;
    if (!use) use = await session.signIn();
    if (!use) return;
    try {
      await toggle.mutateAsync({ kind, enabled: next, existing: byKind(kind) });
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const summary = sample ? "connect to switch" : !own ? "owner only" : token ? `${on} of ${AUTOMATIONS.length} on · Autopilot ${keeperOn ? "on" : "off"}` : "sign in to switch";

  return (
    <section id="automations" className="ep-auto" aria-label="Automations">
      <button type="button" className={cx("ep-auto-h", FOCUS_RING)} aria-expanded={open} aria-controls="ep-auto-list" onClick={onToggleOpen}>
        <Glyph name="shield" scale={2} />
        <span className="t-tag">Automations</span>
        <span className="t-tag t-faint ml-auto">{summary}</span>
        <span aria-hidden="true" className="t-faint">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open ? (
        <div id="ep-auto-list" className="ep-auto-b stepin">
          <ul aria-label="Automation switches">
            {AUTOMATIONS.map((item) => {
              const existing = byKind(item.kind);
              const enabled = existing?.enabled ?? false;
              const known = skills.data?.automations.some((entry) => entry.kind === item.kind) ?? true;
              return (
                <li key={item.kind} className="ep-arow" title={item.body}>
                  <Toggle checked={enabled} onChange={(next) => void onSwitch(item.kind, next)} label={`${item.title}: ${enabled ? "on" : "off"}`} disabled={!own || !known || toggle.isPending || session.busy} />
                  <span className="min-w-0 flex-1">
                    <b>{item.title}</b>
                    <span className="t-tag t-faint block !text-[9px]">{item.cap}</span>
                  </span>
                  <span className="t-tag t-mute !text-[9px]">{enabled ? (existing?.keeper ? "keeper · capped" : "drafts only") : "off"}</span>
                </li>
              );
            })}
          </ul>
          <div className="ep-arow ep-keeper">
            <Glyph name="anchor" scale={2} />
            <span className="min-w-0 flex-1">
              <b>Autopilot</b>
              <span className="t-tag t-faint block !text-[9px]">reduce-only · daily cap · expiry · revoke</span>
            </span>
            <button type="button" className={cx("b xs", FOCUS_RING)} onClick={() => setCapsOpen(true)} disabled={!own}>
              {keeperOn ? "Caps · on" : "Set caps ▸"}
            </button>
          </div>
          <p className="t-tag t-faint px-1 !text-[9px]" aria-live="polite">
            {problem ? <span className="block normal-case text-down">{problem}</span> : null}
            {sample ? "Connect your wallet to switch automations on your own range." : !own ? "Watching another range: only its owner can switch automations." : token ? "Each run drafts proposals you sign" : session.address ? "Switching asks your wallet to sign in once (a message, not a transaction)" : "Connect your wallet to switch automations"}
          </p>
        </div>
      ) : null}
      <Dialog open={capsOpen} onClose={() => setCapsOpen(false)} title="Autopilot: let Ely act, inside caps you sign" description="A fresh trade-only key that can only shrink positions (reduce-only), up to a per-order and a daily cap, for a few days. It can never withdraw or transfer. Your wallet signs the approval once; revoke any time." size="md">
        <div className="ely2">
          <KeeperCaps token={token} onSignIn={() => void session.signIn()} />
        </div>
      </Dialog>
    </section>
  );
}

/** Autopilot: the keeper's caps, signed once in the wallet (approveAgent), revocable in one tap. */
function KeeperCaps({ token, onSignIn }: { readonly token: string | null; readonly onSignIn: () => void }) {
  const status = useKeeperStatus(token);
  const flow = useKeeperFlow(token);
  const [days, setDays] = useState(7);
  const [maxOrder, setMaxOrder] = useState(DEFAULT_KEEPER_LIMITS.maxOrderUsd);
  const [maxDaily, setMaxDaily] = useState(DEFAULT_KEEPER_LIMITS.maxDailyUsd);
  const state = status.data?.state ?? "none";
  const unavailable = status.error ? describeError(status.error) : null;
  const active = state === "active";
  return (
    <div className="flex flex-col gap-3">
      <p className="t-tag t-faint">{token ? (active ? `active until ${status.data?.validUntil?.slice(0, 10) ?? "—"} · spent today $${status.data?.spentTodayUsd ?? 0}` : unavailable ? `unavailable · ${unavailable}` : `state · ${state}`) : "sign in to see the keeper"}</p>
      <dl className="grid grid-cols-3 gap-3 text-center">
        <Cap label="Per order" value={`$${maxOrder}`} onMinus={() => setMaxOrder((v) => Math.max(50, v - 50))} onPlus={() => setMaxOrder((v) => Math.min(2_000, v + 50))} disabled={active || flow.busy} />
        <Cap label="Per day" value={`$${maxDaily}`} onMinus={() => setMaxDaily((v) => Math.max(100, v - 250))} onPlus={() => setMaxDaily((v) => Math.min(10_000, v + 250))} disabled={active || flow.busy} />
        <Cap label="Expiry" value={`${days} d`} onMinus={() => setDays((v) => Math.max(1, v - 1))} onPlus={() => setDays((v) => Math.min(30, v + 1))} disabled={active || flow.busy} />
      </dl>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="chip tiny">reduce-only</span>
        <span className="chip tiny">no withdrawals</span>
        <span className="chip tiny">kill switch</span>
      </div>
      {!token ? (
        <button type="button" className={cx("b acc", FOCUS_RING)} onClick={onSignIn}>
          Sign in to set caps
        </button>
      ) : active ? (
        <button type="button" className={cx("b dn", FOCUS_RING)} onClick={() => void flow.revoke()} disabled={flow.busy}>
          Revoke the keeper
        </button>
      ) : (
        <button type="button" className={cx("b acc", FOCUS_RING)} disabled={flow.busy || unavailable !== null} onClick={() => void flow.enable({ days, limits: { maxOrderUsd: maxOrder, maxDailyUsd: maxDaily } })}>
          {flow.step === "prepare" ? "Preparing…" : flow.step === "sign" ? "Check your wallet…" : flow.step === "submit" ? "Sending to HyperCore…" : flow.step === "activate" ? "Checking the chain…" : "Sign these caps in my wallet"}
        </button>
      )}
      {flow.error ? (
        <p role="alert" className="text-center text-[12px] text-down">
          {flow.error}
        </p>
      ) : null}
    </div>
  );
}

function Cap({ label, value, onMinus, onPlus, disabled }: { readonly label: string; readonly value: string; readonly onMinus: () => void; readonly onPlus: () => void; readonly disabled: boolean }) {
  return (
    <div className="ro fr flat">
      <dt>
        <b>{label}</b>
      </dt>
      <dd className="m-0 flex items-center justify-center gap-1.5">
        <button type="button" className={cx("b xs", FOCUS_RING)} onClick={onMinus} disabled={disabled} aria-label={`Lower ${label}`}>
          −
        </button>
        <span className="num disp text-[17px]">{value}</span>
        <button type="button" className={cx("b xs", FOCUS_RING)} onClick={onPlus} disabled={disabled} aria-label={`Raise ${label}`}>
          +
        </button>
      </dd>
    </div>
  );
}
