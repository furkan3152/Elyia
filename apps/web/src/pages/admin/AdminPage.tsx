import { evmNetwork } from "../../app/wallet/chains";
import { useMemo, useState } from "react";

import { SessionBar, shortAddress, useSession } from "../../features/session";
import { SessionBridge } from "../../features/session/SessionBridge";
import { Ely } from "../../pixel/Ely";
import { cx, FOCUS_RING } from "../../ui/cx";
import { PortalShell, type PortalNavGroup } from "../developers/portal/PortalShell";
import { Card } from "../developers/portal/ui";
import { useContractsConfig, useDeployments, useDeployPlan } from "./adminApi";
import { recordedOn, useRecordsByContract } from "./contracts";
import { ContractCard, DeployFlow } from "./ContractsSection";
import { DEPLOYABLE, NETWORK_OPTIONS, type AdminNetwork, type Deployable } from "./deployModel";
import { mockDeployState } from "./mockFlow";
import { PlatformSection } from "./PlatformSection";
import { RouterSection } from "./RouterSection";
import { useDeploy } from "./useDeploy";

const GROUPS: readonly PortalNavGroup[] = [
  {
    title: "On chain",
    items: [
      { id: "contracts", label: "Contracts", glyph: "block", badge: 3, keywords: "router factory orders" },
      { id: "deployments", label: "Deployments", glyph: "flag", keywords: "deploy camps wallet" },
      { id: "router", label: "Router fee", glyph: "percent", keywords: "protocol fee bps" },
      { id: "pause", label: "Pause", glyph: "pause", keywords: "kill switch" },
    ],
  },
  {
    title: "Platform",
    items: [
      { id: "flags", label: "Feature flags", glyph: "grid" },
      { id: "health", label: "Health", glyph: "pulse", keywords: "rpc latency" },
      { id: "usage", label: "Usage", glyph: "people" },
      { id: "audit", label: "Audit log", glyph: "book", keywords: "records" },
    ],
  },
];

/** Signed out or not an owner: a calm door, no admin data. */
function OwnerOnly({ signedIn }: { readonly signedIn: boolean }) {
  return (
    <section aria-labelledby="owner-only" className="mx-auto flex max-w-[620px] flex-col items-center py-20 text-center">
      <Ely state={signedIn ? "sleep" : "watch"} size={120} label={signedIn ? "Ely asleep at the owner's door" : "Ely on watch at the owner's door"} />
      <span className="label-tab mt-6 font-tag text-[10px] uppercase tracking-[0.08em]">Owner only</span>
      <h1 id="owner-only" className="mt-4 font-display text-[clamp(2rem,4vw,2.8rem)] font-bold leading-tight text-ink">
        {signedIn ? "This console is for the owner." : "Sign in as the owner."}
      </h1>
      <p className="mt-3 max-w-[480px] text-[14px] leading-relaxed text-ink-2">
        {signedIn
          ? "Your wallet session is fine, it just is not on the owner allowlist. Nothing here is hidden from you that would matter for your money: contract addresses are public at /v1/config/contracts."
          : "The owner console deploys and configures Elyia's contracts from the owner's own wallet. Sign a message to prove you hold an allowlisted address; it moves no funds."}
      </p>
      <Card className="mt-8 w-full p-6">
        <SessionBar purpose="open the owner console" variant="panel" />
      </Card>
    </section>
  );
}

function NetworkSegment({ value, onChange }: { readonly value: AdminNetwork; readonly onChange: (next: AdminNetwork) => void }) {
  return (
    <div role="radiogroup" aria-label="Network" className="mx-auto flex w-full flex-col gap-[2px] bg-rule p-[2px] sm:w-fit sm:flex-row">
      {NETWORK_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={value === option.key}
          disabled={!option.enabled}
          title={option.note}
          onClick={() => onChange(option.key)}
          className={cx("px-3 py-2 font-tag text-[10px] uppercase tracking-[0.04em] disabled:cursor-not-allowed disabled:text-ink-3", value === option.key ? "bg-accent text-accent-ink" : "bg-card text-ink-2 hover:bg-paper-2", FOCUS_RING)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Console({ owner }: { readonly owner: string }) {
  const [network, setNetwork] = useState<AdminNetwork>("elysium-testnet");
  const config = useContractsConfig(true);
  const deployments = useDeployments(true);
  const plan = useDeployPlan(network, true);
  const records = useRecordsByContract(deployments.data?.deployments, network);
  const recorded = useMemo(() => recordedOn(config.data, network), [config.data, network]);
  const nextUp = DEPLOYABLE.find((name) => !recorded[name]) ?? "ElyOrders";
  const [picked, setPicked] = useState<Deployable | null>(null);
  const selected = picked ?? nextUp;
  const deploy = useDeploy(selected, network, recorded, plan.data);
  const mock = import.meta.env.DEV ? mockDeployState(window.location.search, owner, selected, network) : null;
  const state = mock ?? deploy.state;
  const native = evmNetwork(network).nativeCurrency.symbol;

  return (
    <>
      <section id="contracts" aria-labelledby="admin-title" className="scroll-mt-28 pt-12">
        <div className="mx-auto flex max-w-[860px] flex-col items-center text-center">
          <span className="label-tab font-tag text-[10px] uppercase tracking-[0.08em]">
            <span aria-hidden="true" className="inline-block h-[6px] w-[6px] bg-up" />
            Owner only · allowlisted {shortAddress(owner)}
          </span>
          <h1 id="admin-title" className="mt-5 font-display text-[clamp(2.2rem,4.6vw,3.4rem)] font-bold leading-[1.05] text-ink">
            Your contracts, your wallet.
          </h1>
          <p className="mt-4 max-w-[600px] text-[14.5px] leading-relaxed text-ink-2 text-pretty">Elyia never holds a deployer key. You deploy and configure from your own wallet; the server checks the receipt and the bytecode before it records anything.</p>
        </div>
        <div className="mt-7">
          <NetworkSegment
            value={network}
            onChange={(next) => {
              setNetwork(next);
              setPicked(null);
              deploy.reset();
            }}
          />
        </div>
        <div className="mt-7 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {DEPLOYABLE.map((name) => (
            <ContractCard
              key={name}
              contract={name}
              network={network}
              config={config.data}
              record={records.get(name)}
              flow={name === selected ? state : null}
              selected={name === selected && !recorded[name]}
              onDeploy={() => {
                setPicked(name);
                deploy.reset();
                document.getElementById("deployments")?.scrollIntoView({ block: "start" });
              }}
            />
          ))}
        </div>
        {config.isError ? <p className="mt-3 text-center text-[12px] text-down">Contract config did not load; cards show the artifacts only.</p> : null}
      </section>
      <DeployFlow
        contract={selected}
        network={network}
        state={state}
        walletAddress={deploy.address}
        walletChainId={deploy.walletChainId}
        nativeSymbol={native}
        mocked={mock !== null}
        recordedAt={recorded[selected] ?? null}
        onPreview={() => void deploy.preview()}
        onSign={() => {
          const current = "preview" in state ? state.preview : state.phase === "failed" && "preview" in state.previous ? state.previous.preview : null;
          if (current && !mock) void deploy.sign(current);
        }}
        onReset={deploy.reset}
      />
      <RouterSection network={network} routerAddress={recorded.ElyiaRouter ?? null} />
      <PlatformSection deployments={deployments.data?.deployments ?? []} />
    </>
  );
}

/**
 * The owner console (v2 screen 04) at /admin. Gated by an admin SIWE session:
 * anyone else sees a calm "owner only" door and no admin data is requested.
 * Every on-chain write is signed by the owner's wallet; the server only
 * verifies and records.
 */
export default function AdminPage() {
  const { session, status } = useSession();
  const admin = Boolean(session?.roles.includes("admin")) && status !== "expired";
  return (
    <>
      <SessionBridge />
      <PortalShell
        chip="Owner console"
        navLabel="Owner console"
        groups={GROUPS}
        searchPlaceholder="Search the console"
        note={
          <>
            <span className="font-tag text-[10px] uppercase text-accent">No server keys</span>
            <br />
            Every on-chain change here is signed by your wallet. The server only checks and records.
          </>
        }
        barRight={
          <>
            <SessionBar purpose="open the owner console" />
          </>
        }
      >
        {admin && session ? <Console owner={session.address} /> : <OwnerOnly signedIn={Boolean(session)} />}
      </PortalShell>
    </>
  );
}
