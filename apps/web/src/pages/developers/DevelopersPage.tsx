import { useMemo, useState } from "react";

import { SessionBar, useSession, WalletBridgeIsland, useWalletBridge } from "../../features/session";
import { devAccess } from "./access";
import { useApiHealth, useDeveloperMe, useKeys } from "./devApi";
import { PortalShell, type PortalNavGroup, type PortalView } from "./portal/PortalShell";
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
 * The developer portal (v2 screen 03, Kletia-style): a side nav over six
 * sub-views picked by the URL hash (overview with the infra hero, the live
 * playground, the @elyia/sdk quickstart and MCP, keys and usage, webhooks /
 * widget / integrator fee, and the reference); `#section` deep links open
 * the right view. Public
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
          { id: "overview", label: "Overview", glyph: "peak", keywords: "base url status", view: "overview" },
          { id: "ways", label: "Four ways in", glyph: "flag", keywords: "build apps agents widget bots", view: "overview" },
        ],
      },
      {
        title: "Build",
        items: [
          { id: "playground", label: "Playground", glyph: "grid", keywords: "parse plan intent try", view: "playground" },
          { id: "sdk", label: "Quickstart · SDK", glyph: "block", keywords: "sdk typescript elyia/sdk code", view: "sdk" },
          { id: "mcp", label: "MCP server", glyph: "plug", keywords: "agent tools", view: "sdk" },
          { id: "widget", label: "Widget", glyph: "widget", keywords: "embed", view: "webhooks" },
        ],
      },
      {
        title: "Your project",
        items: [
          { id: "keys", label: "API keys", glyph: "key", badge: keyCount, keywords: "create rotate revoke secret", view: "keys" },
          { id: "usage", label: "Usage", glyph: "pulse", keywords: "quota meter requests plans prepares", view: "keys" },
          { id: "webhooks", label: "Webhooks", glyph: "hook", keywords: "events deliveries hmac test", view: "webhooks" },
          { id: "fee", label: "Integrator fee", glyph: "percent", keywords: "bps earn recipient", view: "webhooks" },
        ],
      },
      {
        title: "Reference",
        items: [
          { id: "rest", label: "REST API", glyph: "docs", keywords: "endpoints routes", view: "rest" },
          { id: "events", label: "Events", glyph: "bolt", keywords: "webhook types", view: "rest" },
          { id: "errors", label: "Errors", glyph: "eye", keywords: "codes envelope", view: "rest" },
          { id: "rulebook", label: "Rule Book", glyph: "book", keywords: "policy guard", view: "rest" },
          { id: "changelog", label: "Changelog", glyph: "clock", keywords: "versions", view: "rest" },
        ],
      },
    ],
    [keyCount],
  );

  // Sub-views (the hash picks one; /developers#webhooks still deep-links to its section).
  const views: PortalView[] = [
    {
      id: "overview",
      label: "Overview",
      node: (
        <>
          <Overview onGetKey={() => scrollToSection("keys")} />
          <WaysIn />
        </>
      ),
    },
    { id: "playground", label: "Playground", node: <Playground address={session?.address ?? bridgeAddress} feeBps={feeBps} project={project} /> },
    { id: "sdk", label: "Quickstart and MCP", node: <SdkMcp /> },
    { id: "keys", label: "Keys and usage", node: <KeysUsage access={access} now={now} /> },
    { id: "webhooks", label: "Webhooks, widget, fee", node: <ShipIt access={access} now={now} feeBps={feeBps} setFeeBps={setFeeDraft} project={project} /> },
    { id: "rest", label: "Reference", node: <Reference /> },
  ];

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
        views={views}
        barRight={
          <>
            <ApiStatus />
            <SessionBar purpose="manage your project" />
          </>
        }
      >
      </PortalShell>
    </>
  );
}
