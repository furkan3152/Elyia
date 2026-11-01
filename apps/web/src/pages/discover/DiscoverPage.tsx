import { PROTOCOLS } from "@elyia/core/protocols";
import { useMemo } from "react";

import { endpointState, useProtocols, useProtocolsLive } from "../../lib/discovery";
import { liveSummary, mergeLive } from "../../lib/discoveryModel";

import { useUiStore } from "../../app/state/uiStore";
import { Page, Section } from "../../pixel/layout";
import { sheetTag } from "../track/flow/pixelHooks";
import { AscentsRadar } from "./AscentsRadar";
import { boardSigns } from "./board";
import { ShieldPanel } from "./ShieldPanel";
import { TrailBoard } from "./TrailBoard";

/**
 * "/app/discover": first ascents. What is new on the Floor (a radar of the
 * newest HyperCore spot launches, live), whether a token is safe to climb
 * (Shield, from the public RPC and the verified list), and who is building
 * on each altitude (the registry as a trail board, with a route to plan
 * wherever Elyia executes).
 */
export default function DiscoverPage() {
  const mode = useUiStore((state) => state.mode);
  // The registry as the API runs it (`executable` from its engine), else the core copy.
  const registry = useProtocols();
  const rows = registry.data?.protocols ?? PROTOCOLS;
  const signs = useMemo(() => boardSigns(rows), [rows]);
  const open = signs.filter((sign) => sign.condition === "open").length;
  const routable = signs.filter((sign) => sign.executable).length;
  const liveTest = useProtocolsLive("elysium-testnet");
  const liveMain = useProtocolsLive("elysium-mainnet");
  const live = useMemo(() => mergeLive([liveTest.data, liveMain.data]), [liveTest.data, liveMain.data]);
  const liveState = endpointState(liveTest);
  const liveNote =
    liveState === "live"
      ? `live check · ${[liveTest.data, liveMain.data].flatMap((response) => (response ? [liveSummary(response)] : [])).join(" · ")}`
      : liveState === "loading"
        ? "live check · reading bytecode and recent logs…"
        : "live check offline · statuses are the registry's (census re-checked 2026-10-31)";
  const registryNote = registry.data ? `registry · GET /v1/protocols · ${registry.data.total} rows · the API's engine executes ${registry.data.executableIds.length}` : registry.isPending ? "registry · reading the API…" : "registry · API offline, the built-in copy";

  return (
    <Page className="!pt-0">
      <Section level={1} tag={sheetTag("07", "First ascents", mode)} title="First ascents." lede="What just launched, whether it is safe to climb, and who is building on each altitude. Every sign says how it knows.">
        <AscentsRadar mode={mode} />
      </Section>
      <Section id="shield" tag="Shield · route condition for any token" title="Is it safe to climb?" lede="Paste a token: Shield reads the contract from the public RPC and Elyia's verified list, and says which checks it could not run. Ely inspects; nothing signs or spends.">
        <ShieldPanel mode={mode} />
      </Section>
      <Section id="board" tag={`The registry · ${signs.length} protocols · ${open} open · Elyia routes through ${routable}`} title="The trail board" lede="All the protocols of the registry, filed under the highest altitude each stands on. Filter by kind, status, network or what Elyia executes; a sign reads OPEN only once its contracts or endpoints were seen working, and the live check says whether they still answer.">
        <p className="-mt-4 mb-8 text-center font-mono text-[11px] text-ink-3" aria-live="polite">
          {registryNote}
          <br />
          {liveNote}
        </p>
        <TrailBoard signs={signs} live={live} />
      </Section>
    </Page>
  );
}
