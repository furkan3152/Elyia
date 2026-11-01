import { API_BASE } from "../../../lib/env";
import { Button } from "../../../ui/Button";
import { copyText } from "../../../ui/clipboard";
import { toast } from "../../../ui/toast";
import { useProtocolCount, useVenues } from "../devApi";
import { InfraDiagram } from "../InfraDiagram";
import { scrollToSection } from "../portal/scroll";
import { Card, Pill, Stat } from "../portal/ui";

/** Hero (headline, key CTA, base URL), the infra drawing and four live stats. */
export function Overview({ onGetKey }: { readonly onGetKey: () => void }) {
  const protocols = useProtocolCount();
  const venues = useVenues();
  const base = `${API_BASE}/v1`;
  const executable = venues.data?.executableProtocols?.length ?? protocols.data?.executable ?? null;
  return (
    <section id="overview" aria-labelledby="overview-title" className="scroll-mt-28 pt-12">
      <div className="mx-auto flex max-w-[860px] flex-col items-center text-center">
        <span className="label-tab font-tag text-[10px] uppercase tracking-[0.08em]">
          <span aria-hidden="true" className="inline-block h-[6px] w-[6px] bg-up" />
          Elyia platform · API v1
        </span>
        <h1 id="overview-title" className="mt-5 font-display text-[clamp(2.3rem,5vw,3.6rem)] font-bold leading-[1.04] text-ink">
          Ely's routes, inside your product.
        </h1>
        <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-ink-2 text-pretty">
          Plan an intent in one sentence and get a ready-to-sign route across HyperCore, HyperEVM and Elysium. Your users sign in their own wallets; your server hears when every leg lands.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
          <Button variant="primary" size="lg" onClick={onGetKey} leftIcon={<span aria-hidden="true">⚿</span>}>
            Get a key
          </Button>
          <Button variant="ink" size="lg" onClick={() => scrollToSection("playground")}>
            Open the playground
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <span className="font-tag text-[10px] uppercase tracking-[0.06em] text-ink-3">Base URL</span>
          <code className="bg-card px-2.5 py-1 font-mono text-[12.5px] text-ink px-frame-thin">{base}</code>
          <Button
            variant="ink"
            size="xs"
            onClick={() => void copyText(base).then((ok) => (ok ? toast.success("Base URL copied") : toast.error("Copy failed: select the text instead")))}
          >
            Copy
          </Button>
          <span className="font-tag text-[10px] uppercase tracking-[0.06em] text-ink-3">· REST · MCP · webhooks</span>
        </div>
      </div>
      <Card flat className="mt-8 bg-card/80 p-4 sm:p-6">
        <InfraDiagram />
      </Card>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        <Stat label="Protocols mapped" value={protocols.data?.total ?? "—"} note={protocols.isError ? "API unreachable" : "live status · shield"} />
        <Stat label="Executable" value={executable ?? "—"} note={venues.isError && protocols.isError ? "API unreachable" : "venues in the auction"} />
        <Stat label="Layers" value="3" note="99801 · 998 · Core" />
        <Stat label="Wallet signs" value="100%" note={<Pill tone="up">never server keys</Pill>} />
      </div>
    </section>
  );
}
