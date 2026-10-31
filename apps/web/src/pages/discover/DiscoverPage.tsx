import { PROTOCOLS } from "@elyia/core/protocols";
import { useMemo } from "react";

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
  const signs = useMemo(() => boardSigns(PROTOCOLS), []);
  const open = signs.filter((sign) => sign.condition === "open").length;
  const routable = signs.filter((sign) => sign.executable).length;

  return (
    <Page className="!pt-0">
      <Section level={1} tag={sheetTag("07", "First ascents", mode)} title="First ascents." lede="What just launched, whether it is safe to climb, and who is building on each altitude. Every sign says how it knows.">
        <AscentsRadar mode={mode} />
      </Section>
      <Section id="shield" tag="Shield · route condition for any token" title="Is it safe to climb?" lede="Paste a token: Shield reads the contract from the public RPC and Elyia's verified list, and says which checks it could not run. Ely inspects; nothing signs or spends.">
        <ShieldPanel mode={mode} />
      </Section>
      <Section id="board" tag={`The registry · ${signs.length} protocols · ${open} open · Elyia routes through ${routable}`} title="The trail board" lede="Each protocol is filed under the highest altitude it stands on. A sign reads OPEN only once its contracts or endpoints were seen working; the rest say why not.">
        <TrailBoard />
      </Section>
    </Page>
  );
}
