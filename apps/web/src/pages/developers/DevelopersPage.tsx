import { useMemo, useState } from "react";

import { Link } from "../../app/routes/Link";
import { ADMIN_ITEM } from "../../app/shell/navItems";
import { FOCUS_RING } from "../../ui/cx";
import { SessionBar, useSession, WalletBridgeIsland, useWalletBridge } from "../../features/session";
import { devAccess } from "./access";
import { useApiHealth, useDeveloperMe, useKeys } from "./devApi";
import { PortalShell, type PortalNavGroup } from "./portal/PortalShell";
import { scrollToSection } from "./portal/scroll";
import { Pill } from "./portal/ui";
import { KeysUsage } from "./sections/KeysUsage";
import { Overview } from "./sections/Overview";
import { Playground } from "./sections/Playground";
import { Reference } from "./sections/Reference";
import { SdkMcp } from "./sections/SdkMcp";
import { ShipIt } from "./sections/ShipIt";
import { WaysIn } from "./sections/WaysIn";

/** Shown while signed out: the fee preview starts where the mockup does. */
const SAMPLE_FEE_BPS = 15;

function ApiStatus() {
  const health = useApiHealth();
  if (health.isLoading) return <Pill tone="mute">API · checking</Pill>;
  if (health.isError || !health.data) return <Pill tone="dn" dot>API down</Pill>;
  const ok = health.data.status === "ok";
  return (
    <Pill tone={ok ? "up" : "warn"} dot>
      API {ok ? "up" : health.data.status} · v1
    </Pill>
  );
}

/**
 * The developer portal (v2 screen 03, Kletia-style): a side nav, the infra
 * hero, then keys and usage, a live playground, the quickstart and MCP,
 * webhooks, the widget and the integrator fee, and the reference. Public
 * visitors see labelled samples; a wallet session (SIWE) manages the real
 * project. Nothing here can sign or move funds.
 */
export default function DevelopersPage() {
  const { session } = useSession();
  const access = devAccess(session);
  const me = useDeveloperMe();
  const keys = useKeys();
  const bridgeAddress = useWalletBridge((state) => state.address);
  const [feeDraft, setFeeDraft] = useState<number | null>(null);
  const [now] = useState(() => Date.now());

  const savedFee = access === "developer" ? me.data?.fee.feeBps : undefined;
  const feeBps = feeDraft ?? savedFee ?? (access === "developer" ? 0 : SAMPLE_FEE_BPS);
  const project = access === "developer" ? (me.data?.profile.name ?? "your app") : "your app";
  const keyCount = access === "developer" ? keys.data?.keys.filter((key) => key.revokedAt === null).length : undefined;

  const groups = useMemo<PortalNavGroup[]>(
    () => [
      {
        title: "Start",
        items: [
          { id: "overview", label: "Overview", glyph: "peak", keywords: "base url status" },
          { id: "ways", label: "Four ways in", glyph: "flag", keywords: "build apps agents widget bots" },
        ],
      },
      {
        title: "Build",
        items: [
          { id: "playground", label: "Playground", glyph: "grid", keywords: "parse plan intent try" },
          { id: "sdk", label: "Quickstart · TypeScript", glyph: "block", keywords: "sdk fetch code" },
          { id: "mcp", label: "MCP server", glyph: "plug", keywords: "agent tools claude" },
          { id: "widget", label: "Widget", glyph: "widget", keywords: "embed" },
        ],
      },
      {
        title: "Your project",
        items: [
          { id: "keys", label: "API keys", glyph: "key", badge: keyCount, keywords: "create rotate revoke secret" },
          { id: "usage", label: "Usage", glyph: "pulse", keywords: "quota meter requests plans prepares" },
          { id: "webhooks", label: "Webhooks", glyph: "hook", keywords: "events deliveries hmac test" },
          { id: "fee", label: "Integrator fee", glyph: "percent", keywords: "bps earn recipient" },
        ],
      },
      {
        title: "Reference",
        items: [
          { id: "rest", label: "REST API", glyph: "docs", keywords: "endpoints routes" },
          { id: "events", label: "Events", glyph: "bolt", keywords: "webhook types" },
          { id: "errors", label: "Errors", glyph: "eye", keywords: "codes envelope" },
          { id: "rulebook", label: "Rule Book", glyph: "book", keywords: "policy guard" },
          { id: "changelog", label: "Changelog", glyph: "clock", keywords: "versions" },
        ],
      },
    ],
    [keyCount],
  );

  return (
    <>
      <WalletBridgeIsland />
      <PortalShell
        chip="Developers"
        navLabel="Developer portal"
        groups={groups}
        searchPlaceholder="Search docs, endpoints, events"
        note={
          <>
            <span className="font-tag text-[10px] uppercase text-accent">Nov 9</span>
            <br />
            Elysium mainnet 99901 opens. Keys stay the same; the API's mode picks the network.
          </>
        }
        barRight={
          <>
            <ApiStatus />
            {session?.roles.includes("admin") ? (
              <Link to={ADMIN_ITEM.href} className={`font-tag text-[10px] uppercase text-accent underline-offset-2 hover:underline ${FOCUS_RING}`}>
                {ADMIN_ITEM.label} ↗
              </Link>
            ) : null}
            <SessionBar purpose="manage your project" />
          </>
        }
      >
        <Overview
          onGetKey={() => {
            scrollToSection("keys");
          }}
        />
        <WaysIn />
        <KeysUsage access={access} now={now} />
        <Playground address={session?.address ?? bridgeAddress} feeBps={feeBps} project={project} />
        <SdkMcp />
        <ShipIt access={access} now={now} feeBps={feeBps} setFeeBps={setFeeDraft} project={project} />
        <Reference />
      </PortalShell>
    </>
  );
}
