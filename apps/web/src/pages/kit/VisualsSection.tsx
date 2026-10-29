import { useRef } from "react";

import { usePulseFeed, usePulseSelector } from "../../hooks/usePulse";
import { AuroraBackdrop } from "../../motion/AuroraBackdrop";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { Constellation, type ConstellationGroup } from "../../visuals/constellation/Constellation";
import type { StarLink, StarNode } from "../../visuals/constellation/layout";
import { Lyre, type LyreHandle, type LyreString } from "../../visuals/lyre/Lyre";
import { LiveSun } from "../../visuals/sun/LiveSun";
import { MiniSun } from "../../visuals/sun/MiniSun";
import { KitSection } from "./KitSection";

/* Kit sample data (documentation only). */
const STRINGS: readonly LyreString[] = [
  { id: "HYPE", label: "HYPE", sublabel: "+4.2%", amplitude: 0.7, tint: "mint", thickness: 1 },
  { id: "BTC", label: "BTC", sublabel: "+1.1%", amplitude: 0.25, tint: "mint", thickness: 0.6 },
  { id: "ETH", label: "ETH", sublabel: "−2.3%", amplitude: 0.45, tint: "rose", thickness: 0.75 },
  { id: "SOL", label: "SOL", sublabel: "+0.2%", amplitude: 0.1, tint: "violet", thickness: 0.3 },
  { id: "PURR", label: "PURR", sublabel: "+9.8%", amplitude: 1, tint: "mint", thickness: 0.2 },
  { id: "kHYPE", label: "kHYPE", sublabel: "staked", amplitude: 0.05, tint: "gold", thickness: 0.5 },
  { id: "FART", label: "FART", sublabel: "−12%", amplitude: 0.9, tint: "rose", thickness: 0.1 },
];

const GROUPS: readonly ConstellationGroup[] = [
  { id: "hypercore", label: "HyperCore", tone: "violet" },
  { id: "hyperevm", label: "HyperEVM", tone: "sky" },
  { id: "elysium", label: "Elysium", tone: "gold" },
];

const NODES: readonly StarNode[] = [
  { id: "hype-perp", label: "HYPE perp", group: "hypercore", value: 12_400, sublabel: "$12,400" },
  { id: "eth-perp", label: "ETH perp", group: "hypercore", value: 8_950, sublabel: "$8,950" },
  { id: "btc-perp", label: "BTC perp", group: "hypercore", value: 6_020, sublabel: "$6,020" },
  { id: "hlp", label: "HLP", group: "hypercore", value: 2_500, sublabel: "$2,500" },
  { id: "usdc-evm", label: "USDC", group: "hyperevm", value: 7_200, sublabel: "$7,200" },
  { id: "hype-evm", label: "HYPE", group: "hyperevm", value: 2_925, sublabel: "$2,925" },
  { id: "khype", label: "kHYPE", group: "elysium", value: 5_100, sublabel: "$5,100" },
  { id: "usdc-ely", label: "USDC", group: "elysium", value: 2_400, sublabel: "$2,400" },
  { id: "purr", label: "PURR", group: "elysium", value: 696, sublabel: "$696" },
];

const LINKS: readonly StarLink[] = [
  { source: "usdc-evm", target: "usdc-ely", kind: "path" },
  { source: "hype-perp", target: "khype", kind: "hedge" },
];

const selectStatus = (snapshot: { status: "connecting" | "live" | "fallback" | "stale" | "offline" }) => snapshot.status;

/** The signature visuals: Sun, MiniSun, Lyre, Constellation, aurora. */
export function VisualsSection() {
  const lyreRef = useRef<LyreHandle>(null);
  const feed = usePulseFeed();
  const status = usePulseSelector(selectStatus);
  return (
    <>
      <KitSection
        id="sun"
        title="Sun · LiveSun · MiniSun"
        description="One ray per real Elysium block, advancing one slot per block around the rim (bursts spread at the measured cadence), fading over ~1.2 s. LiveSun wires the shared pulse (API stream, RPC fallback); Sun takes a feed and a readout. MiniSun beats once every 10 blocks (about 1 Hz, never at block rate)."
        code={'<LiveSun />                       // fluid, square\n<LiveSun variant="compact" size={180} />\n<Sun feed={feed} readout={{ head, blockTimeMs, gasGwei, tps, status }} size={420} />\n<MiniSun feed={usePulseFeed()} status={status} />'}
      >
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div className="mx-auto w-full max-w-[380px]">
            <LiveSun />
          </div>
          <div className="flex flex-col items-center gap-6">
            <LiveSun variant="compact" size={180} />
            <span className="flex items-center gap-2 font-mono text-xs text-text-1">
              <MiniSun feed={feed} status={status} /> heartbeat ({status})
            </span>
          </div>
        </div>
      </KitSection>

      <KitSection
        id="lyre"
        title="Lyre"
        description="Seven strings: amplitude 0..1 hums with volatility, tint mint/rose/violet/gold, thickness 0..1 by size. ref.pluck(id) on a trade print. Hover or focus reveals the label; click calls onSelect. 60 fps while on screen, static with reduced motion, crisp on HiDPI."
        code={'const lyre = useRef<LyreHandle>(null);\n<Lyre ref={lyre} strings={strings} label="Your positions" onSelect={(id) => navigate(routeHref("trade", { market: id }))} />\nlyre.current?.pluck("ETH", 0.8);'}
      >
        <Panel variant="raised" padding="lg">
          <Lyre ref={lyreRef} strings={STRINGS} label="Kit sample positions" height={280} />
          <div className="mt-2 flex flex-wrap gap-2">
            {STRINGS.map((string) => (
              <Button key={string.id} size="xs" variant="outline" onClick={() => lyreRef.current?.pluck(string.id, 1)}>
                pluck {string.label}
              </Button>
            ))}
          </div>
        </Panel>
      </KitSection>

      <KitSection
        id="constellation"
        title="Constellation"
        description="Own Stars: one sky per layer, one star per holding (radius ∝ √value), links for intent paths (dashed gold) and hedges (rose). Deterministic layout from the ids, so a portfolio never reshuffles. Stars are focusable buttons."
        code={'<Constellation label="Portfolio" groups={groups} nodes={nodes} links={links} onSelect={setSelected} selectedId={selected} />'}
      >
        <Panel variant="glass" padding="md">
          <Constellation label="Kit sample constellation" groups={GROUPS} nodes={NODES} links={LINKS} height={300} />
        </Panel>
      </KitSection>

      <KitSection
        id="aurora"
        title="AuroraBackdrop"
        description="Violet-to-gold radial gradients drifting over ~25 s (transform only); static under reduced motion, paused in hidden tabs. variant hero (landing, with stars), page, or app (quiet)."
        code={'<AuroraBackdrop variant="hero" />   // inside a relative, isolated parent'}
      >
        <div className="relative isolate h-56 overflow-hidden rounded-3xl border border-line bg-bg-0">
          <AuroraBackdrop variant="hero" />
          <p className="relative z-10 flex h-full items-center justify-center font-display text-4xl italic text-violet-soft">Lumine purpureo</p>
        </div>
      </KitSection>
    </>
  );
}
