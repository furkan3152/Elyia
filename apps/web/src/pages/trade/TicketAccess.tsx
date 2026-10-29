import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowUpRight, Droplets, Eye, KeyRound, Lock, ShieldCheck, Wallet, Zap } from "lucide-react";
import { useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { navigate } from "../../app/routes/useRoute";
import { useAgentStore } from "../../features/agentKey/agentSession";
import { daysLeft } from "../../features/agentKey/approve";
import { shortAddress } from "../../lib/format";
import { Button, ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import type { Access } from "./access";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

/** The teaching card for an account with nothing on HyperCore yet. */
export function FundingTeach({ className }: { readonly className?: string }) {
  const { endpoints, mode } = useTerminal();
  return (
    <div className={cx("rounded-xl border border-sky/30 bg-sky/[0.06] p-3.5 text-[13px] leading-relaxed", className)}>
      <p className="flex items-center gap-2 font-medium text-text-0">
        <Droplets className="h-4 w-4 text-sky" aria-hidden="true" />
        No USDC on HyperCore {mode} yet
      </p>
      <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-text-1">
        <li>
          Hyperliquid’s faucet drips 1,000 mock USDC, but only to addresses that have deposited on mainnet before.{" "}
          <a href={`${endpoints.appUrl}/drip`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-sky underline-offset-2 hover:underline">
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
            className="text-sky underline-offset-2 hover:underline"
          >
            Open Bridge
          </a>
        </li>
      </ol>
      <p className="mt-2 text-xs text-text-2">A new HyperCore account pays a one-time 1 USDC activation fee on its first deposit.</p>
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
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-bg-2/60 px-2.5 focus-within:border-violet-glow/60">
        <Eye className="h-3.5 w-3.5 shrink-0 text-text-2" aria-hidden="true" />
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            go();
          }}
          placeholder="or view any address 0x…"
          aria-label="View an address read-only"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-xs text-text-0 outline-none placeholder:text-text-2"
        />
      </label>
      <Button type="button" size="sm" variant="outline" disabled={!valid} onClick={go}>
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
      <div className={cx("flex flex-col gap-2 rounded-xl border border-violet-glow/30 bg-violet/[0.08] p-3 text-[13px] text-text-1", className)}>
        <p className="flex items-center gap-2 text-text-0">
          <Eye className="h-4 w-4 text-violet-soft" aria-hidden="true" />
          Viewing <span className="font-mono">{shortAddress(viewAs ?? "")}</span> · read only
        </p>
        <p className="text-xs text-text-2">Positions, orders and fills of any HyperCore account, live. Nothing can be signed here.</p>
        <ButtonLink to={routeHref("trade", { market: market?.slug ?? "BTC" })} variant="outline" size="sm">
          Back to my account
        </ButtonLink>
      </div>
    );
  }
  if (access === "unfunded") {
    return (
      <div className={cx("flex flex-col gap-2", className)}>
        <FundingTeach />
        <Button variant="outline" size="lg" fullWidth onClick={() => open({ enableOpen: true })} leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
          Enable trading anyway
        </Button>
      </div>
    );
  }
  if (access === "unsupported") {
    return <p className={cx("rounded-xl border border-rose/30 bg-rose/[0.07] p-3 text-[13px] text-text-1", className)}>{agent.session.error ?? "This browser cannot keep a trading key safely."}</p>;
  }
  if (access === "unlock") {
    return (
      <Button variant="gold" size="xl" fullWidth onClick={() => void agent.unlock()} leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />} className={className}>
        Unlock trading
      </Button>
    );
  }
  if (access === "loading") {
    return (
      <Button variant="soft" size="xl" fullWidth loading className={className}>
        Opening the key vault
      </Button>
    );
  }
  return (
    <Button variant="gold" size="xl" fullWidth onClick={() => open({ enableOpen: true })} leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />} className={className}>
      Enable trading
    </Button>
  );
}

/** "Signed in-browser by elyia-web · trade-only key · can't withdraw", with the key's state and the one-click switch. */
export function AgentBadge({ className }: { readonly className?: string }) {
  const { agent, now, canSign } = useTerminal();
  const oneClick = useAgentStore((state) => state.oneClick);
  const meta = agent.session.meta;
  const openAgent = () => useTerminalUi.getState().set({ agentOpen: true });
  return (
    <div className={cx("flex items-center gap-2 rounded-xl border border-line bg-bg-1/80 px-3 py-2.5 text-xs text-text-1", className)}>
      <ShieldCheck className={cx("h-4 w-4 shrink-0", canSign ? "text-mint" : "text-text-2")} aria-hidden="true" />
      <button type="button" onClick={openAgent} className={cx("min-w-0 flex-1 text-left leading-snug", FOCUS_RING)}>
        Signed in-browser by <b className="font-semibold text-text-0">elyia-web</b> · trade-only key · can’t withdraw
        {meta ? <span className="block text-text-2">{canSign ? "unlocked" : "locked"} · expires in {daysLeft(meta.validUntil, now)} d · manage</span> : <span className="block text-text-2">not enabled on this device · manage</span>}
      </button>
      {canSign ? (
        <button
          type="button"
          onClick={() => useAgentStore.getState().setOneClick(!oneClick)}
          aria-pressed={oneClick}
          title={oneClick ? "One-click is on: the button signs at once (confirmations still ask)" : "Turn on one-click: skip the review step"}
          className={cx(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-mono text-[11px] transition-colors",
            oneClick ? "border-gold/50 bg-gold/[0.14] text-gold" : "border-line-strong text-text-2 hover:text-text-0",
            FOCUS_RING,
          )}
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          {oneClick ? "one-click on" : "one-click"}
        </button>
      ) : null}
    </div>
  );
}
