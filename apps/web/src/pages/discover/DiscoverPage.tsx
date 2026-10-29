import { PROTOCOLS } from "@elyia/core/protocols";
import { useMemo } from "react";

import { useUiStore } from "../../app/state/uiStore";
import { Page } from "../../app/shell/Page";
import { Reveal } from "../../motion/Reveal";
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
    <Page className="flex flex-col gap-14 pb-16 lg:gap-20">
      <section aria-labelledby="discover-title" className="flex flex-col gap-8 pt-4 sm:pt-8">
        <div className="max-w-[1040px]">
          <p className="label-tab mb-5">Sheet 07 · first ascents · {mode === "testnet" ? "practice wall" : "mainnet"}</p>
          <h1 id="discover-title" className="text-[48px] font-bold leading-[0.98] tracking-[-0.03em] text-ink text-balance sm:text-[76px]">
            First ascents.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">
            What just launched, whether it is safe to climb, and who is building on each altitude. Every sign says how it knows.
          </p>
        </div>
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] xl:gap-8">
          <AscentsRadar mode={mode} />
          <ShieldPanel mode={mode} />
        </div>
      </section>

      <Reveal as="section" aria-labelledby="board-title" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="caption">The registry · {signs.length} protocols · {open} open · Elyia routes through {routable}</p>
            <h2 id="board-title" className="mt-2 text-[34px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[40px]">
              The trail board
            </h2>
            <p className="mt-2 max-w-[44rem] text-[17px] leading-relaxed text-ink-2">
              Each protocol is filed under the highest altitude it stands on. A sign reads OPEN only once its contracts or endpoints were seen working; the rest say why not.
            </p>
          </div>
        </div>
        <TrailBoard />
      </Reveal>
    </Page>
  );
}
