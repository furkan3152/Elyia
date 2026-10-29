import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowUpRight, Droplets, Eye, KeyRound, Lock, Wallet, Zap } from "lucide-react";
import { useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import { useAgentStore } from "../../features/agentKey/agentSession";
import { daysLeft } from "../../features/agentKey/approve";
import { shortAddress } from "../../lib/format";
import { Button, ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { fieldBoxClasses } from "../../ui/fieldStyles";
import type { Access } from "./access";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

/** The teaching card for an account with nothing on HyperCore yet. */
export function FundingTeach({ className }: { readonly className?: string }) {
  const { endpoints, mode } = useTerminal();
  return (
    <div className={cx("border-2 border-rule bg-paper/60 p-3.5 text-[13px] leading-relaxed", className)}>
      <p className="flex items-center gap-2 font-bold text-ink">
        <Droplets className="h-4 w-4 text-water" aria-hidden="true" />
        No USDC on the Floor yet
      </p>
      <p className="caption mt-0.5 !text-[11px]">HyperCore {mode} · two ways up</p>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-ink-2">
        <li>
          Hyperliquid’s faucet drips 1,000 mock USDC, but only to addresses that have deposited on mainnet before.{" "}
          <a href={`${endpoints.appUrl}/drip`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-water underline underline-offset-2">
            Open the faucet <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </li>
        <li>
          Or bring test USDC from HyperEVM: the Bridge page deposits it through Circle’s CoreDepositWallet straight into perps.{" "}
          <a
            href={routeHref("bridge")}
            onClick={(event) => {
              event.preventDefault();
              navigate(routeHref("bridge"));
            }}
            className="font-semibold text-water underline underline-offset-2"
          >
            Open Bridge
          </a>
        </li>
      </ol>
      <p className="mt-2 text-xs text-ink-3">A new HyperCore account pays a one-time 1 USDC activation fee on its first deposit.</p>
    </div>
  );
}

function ViewAnyAddress() {
  const [value, setValue] = useState("");
  const { market } = useTerminal();
  const valid = /^0x[0-9a-fA-F]{40}$/u.test(value.trim());
  const go = () => {
    if (valid) navigate(`${routeHref("trade", { market: market?.slug ?? "BTC" })}?as=${value.trim().toLowerCase()}`);
  };
  // Not a <form>: this sits inside the order ticket's form, and forms cannot nest.
  return (
    <div role="group" aria-label="View an address" className="flex items-center gap-1.5">
      <label className={cx(fieldBoxClasses({ size: "sm" }), "flex-1")}>
        <Eye className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            go();
          }}
          placeholder="or survey any address 0x…"
          aria-label="View an address read-only"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-3"
        />
      </label>
      <Button type="button" size="sm" variant="ink" disabled={!valid} onClick={go}>
        View
      </Button>
    </div>
  );
}

/** Replaces the action button when the user cannot trade yet, and says why. */
export function AccessAction({ access, className }: { readonly access: Exclude<Access, "ready">; readonly className?: string }) {
  const { viewAs, market, agent } = useTerminal();
  const open = (values: Parameters<ReturnType<typeof useTerminalUi.getState>["set"]>[0]) => useTerminalUi.getState().set(values);
  if (access === "connect") {
    return (
      <div className={cx("flex flex-col gap-2", className)}>
        <ConnectButton.Custom>
          {({ openConnectModal, mounted }) => (
            <Button variant="primary" size="xl" fullWidth disabled={!mounted} onClick={openConnectModal} leftIcon={<Wallet className="h-4 w-4" aria-hidden="true" />}>
              Connect to trade
            </Button>
          )}
        </ConnectButton.Custom>
        <ViewAnyAddress />
      </div>
    );
  }
  if (access === "readOnly") {
    return (
      <div className={cx("flex items-center gap-2 border-2 border-rule bg-signal/30 px-3 py-2 text-[12px] text-ink-2", className)}>
        <Eye className="h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-bold text-ink">Surveying {shortAddress(viewAs ?? "")}</span> · read only, nothing is signed here.
        </p>
        <ButtonLink to={routeHref("trade", { market: market?.slug ?? "BTC" })} variant="ink" size="xs">
          My sheet
        </ButtonLink>
      </div>
    );
  }
  if (access === "unfunded") {
    return (
      <div className={cx("flex flex-col gap-2", className)}>
        <FundingTeach />
        <Button variant="ink" size="lg" fullWidth onClick={() => open({ enableOpen: true })} leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
          Enable trading anyway
        </Button>
      </div>
    );
  }
  if (access === "unsupported") {
    return <p className={cx("border-2 border-down p-3 text-[13px] text-ink", className)}>{agent.session.error ?? "This browser cannot keep a trading key safely."}</p>;
  }
  if (access === "unlock") {
    return (
      <Button variant="primary" size="xl" fullWidth onClick={() => void agent.unlock()} leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />} className={className}>
        Unlock trading
      </Button>
    );
  }
  if (access === "loading") {
    return (
      <Button variant="ink" size="xl" fullWidth loading className={className}>
        Opening the key vault
      </Button>
    );
  }
  return (
    <Button variant="primary" size="xl" fullWidth onClick={() => open({ enableOpen: true })} leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />} className={className}>
      Enable trading
    </Button>
  );
}

/**
 * The trading-key badge: a small laminated permit (Guide's licence lineage)
 * with a perforated edge: "trade-only · can't withdraw", the key's state and
 * days left, and the one-click switch.
 */
export function AgentBadge({ className }: { readonly className?: string }) {
  const { agent, now, canSign } = useTerminal();
  const oneClick = useAgentStore((state) => state.oneClick);
  const meta = agent.session.meta;
  const openAgent = () => useTerminalUi.getState().set({ agentOpen: true });
  const left = meta ? daysLeft(meta.validUntil, now) : null;
  return (
    <div className={cx("relative flex items-stretch border-2 border-rule bg-card text-xs text-ink-2", className)}>
      <span aria-hidden="true" className="w-2.5 shrink-0 border-r-2 border-dashed border-rule/50 bg-paper-2/60" />
      <button type="button" onClick={openAgent} className={cx("flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left", FOCUS_RING)}>
        <KeyRound className={cx("h-4 w-4 shrink-0", canSign ? "text-up" : "text-ink-3")} aria-hidden="true" />
        <span className="min-w-0 leading-snug">
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink">Trade-only · can’t withdraw</span>
          <span className="block truncate font-mono text-[11px] text-ink-3">
            elyia-web · {meta ? `${canSign ? "unlocked" : "locked"} · ${left} d left` : "not on this device"} · manage
          </span>
        </span>
      </button>
      {canSign ? (
        <button
          type="button"
          onClick={() => useAgentStore.getState().setOneClick(!oneClick)}
          aria-pressed={oneClick}
          title={oneClick ? "One-click is on: the button signs at once (confirmations still ask)" : "Turn on one-click: skip the review step"}
          className={cx(
            "inline-flex shrink-0 items-center gap-1 border-l-2 border-rule px-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors",
            oneClick ? "bg-signal text-signal-ink" : "text-ink-3 hover:bg-paper-2 hover:text-ink",
            FOCUS_RING,
          )}
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          {oneClick ? "1-click on" : "1-click"}
        </button>
      ) : null}
    </div>
  );
}
