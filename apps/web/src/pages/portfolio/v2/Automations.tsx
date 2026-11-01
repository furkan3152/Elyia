import { DEFAULT_KEEPER_LIMITS, type Automation, type AutomationKind } from "@elyia/core/api/agent";
import { useCallback, useState } from "react";

import { useAutomations, useKeeperStatus, useSkills, useSwitchAutomation } from "../../../features/ely/agentApi";
import { paletteOf } from "../../../features/ely/draw";
import { useKeeperFlow } from "../../../features/ely/keeper";
import { Glyph, Toggle } from "../../../features/ely/ui";
import type { WalletSession } from "../../../features/session/useWalletSession";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { describeError } from "../../../lib/api";
import { drawVignette, VIGNETTE_H, VIGNETTE_W, type VignetteKind } from "./draw";

interface ShelfItem {
  readonly kind: AutomationKind;
  readonly title: string;
  readonly body: string;
  readonly vignette: VignetteKind;
  readonly label: string;
  /** The left cap line. */
  readonly cap: string;
}

/** Five equal cards, the kinds Ely runs today (each run only drafts proposals). */
const SHELF: readonly ShelfItem[] = [
  { kind: "auto-protect", title: "Auto-protect", body: "Drafts a stop and a target for every open position that has none.", vignette: "protect", label: "Price between a stop and a target", cap: "drafts TP / SL" },
  { kind: "liquidation-guard", title: "Liquidation guard", body: "Drafts a reduce-only trim when a rope falls under 10% from liquidation.", vignette: "guard", label: "A rope marker pushed back from the edge", cap: "under 10% rope" },
  { kind: "rebalance", title: "Rebalance", body: "Drafts the route back to your target mix when you drift past your band.", vignette: "stairs", label: "Coins climbing stairs to the target", cap: "your target mix" },
  { kind: "idle-sweep", title: "Idle sweeper", body: "Drafts a deposit of idle stablecoins into the verified vault, keeping a buffer.", vignette: "sweep", label: "Idle coins arcing into a vault", cap: "keeps 10% buffer" },
  { kind: "gas-top-up", title: "Gas at camps", body: "Drafts a HYPE top-up for gas on a layer before a route needs it.", vignette: "gas", label: "Gas tanks on three layers", cap: "min 0.2 HYPE" },
];

function Vignette({ kind, on, label }: { readonly kind: VignetteKind; readonly on: boolean; readonly label: string }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawVignette(ctx, kind, info.still ? 0 : info.seconds, on, paletteOf(ctx.canvas)), [kind, on]);
  return <PixelCanvas width={VIGNETTE_W} height={VIGNETTE_H} scale={2} draw={draw} animate={on} fps={on ? 15 : 3} endTime={0} redrawKey={`${kind}|${on}`} label={`${label}${on ? "" : " (off, asleep)"}`} />;
}

export interface AutomationShelfProps {
  readonly session: WalletSession;
  readonly own: boolean;
}

/**
 * The automations shelf. Every automation runs inside a policy: it only
 * drafts proposals the owner signs, unless the owner opts into the keeper,
 * whose caps are shown and signed once in the wallet. Off cards draw dimmed
 * and asleep. Switching needs a wallet session (a sign-in message, not a
 * transaction).
 */
export function AutomationShelf({ session, own }: AutomationShelfProps) {
  const token = own ? session.token : null;
  const automations = useAutomations(token);
  const skills = useSkills();
  const toggle = useSwitchAutomation(token);
  const [problem, setProblem] = useState<string | null>(null);
  const list = automations.data?.automations ?? [];
  const byKind = (kind: AutomationKind): Automation | null => list.find((entry) => entry.kind === kind) ?? null;

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

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5" aria-label="Automations">
        {SHELF.map((item) => {
          const existing = byKind(item.kind);
          const on = existing?.enabled ?? false;
          const known = skills.data?.automations.some((entry) => entry.kind === item.kind) ?? true;
          return (
            <li key={item.kind} className="auto fr">
              <div className="vis">
                <Vignette kind={item.vignette} on={on} label={item.label} />
              </div>
              <div className="row1">
                <b>{item.title}</b>
                <Toggle checked={on} onChange={(next) => void onSwitch(item.kind, next)} label={`${item.title}: ${on ? "on" : "off"}`} disabled={!own || !known || toggle.isPending || session.busy} />
              </div>
              <p>{item.body}</p>
              <div className="cap">
                <span>{item.cap}</span>
                <span>{on ? (existing?.keeper ? "keeper · capped" : "drafts only") : existing ? "off" : "off · ready"}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-center font-tag text-[10px] uppercase text-ink-3" aria-live="polite">
        {problem ? <span className="block normal-case text-down">{problem}</span> : null}
        {!own ? "Watching another range: only its owner can switch automations." : token ? `${list.filter((entry) => entry.enabled).length} on · each run drafts proposals you sign` : session.address ? "Switching asks your wallet to sign in once (a message, not a transaction)" : "Connect your wallet to switch automations"}
      </p>
      {own ? <KeeperCaps token={token} onSignIn={() => void session.signIn()} /> : null}
    </div>
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
    <div className="fr lg mx-auto grid w-full max-w-[960px] grid-cols-1 gap-5 p-5 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <span className="t-tag t-acc flex items-center gap-2">
          <Glyph name="shield" scale={2} /> Autopilot · optional
        </span>
        <h3 className="disp text-[20px]">Let Ely act, inside caps you sign.</h3>
        <p className="text-[12.5px] leading-snug text-ink-2">A fresh trade-only key that can only shrink positions (reduce-only), up to a per-order and a daily cap, for a few days. It can never withdraw or transfer. Your wallet signs the approval once; revoke any time.</p>
        <p className="t-tag t-faint">{token ? (active ? `active until ${status.data?.validUntil?.slice(0, 10) ?? "—"} · spent today $${status.data?.spentTodayUsd ?? 0}` : unavailable ? `unavailable · ${unavailable}` : `state · ${state}`) : "sign in to see the keeper"}</p>
      </div>
      <div className="flex flex-col gap-3">
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
