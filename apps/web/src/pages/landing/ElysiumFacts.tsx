import { routeHref } from "../../app/routes/routeTable";
import { usePulseSelector } from "../../hooks/usePulse";
import { useNow } from "../../hooks/useNow";
import { formatGwei } from "../../lib/format";
import type { PulseSnapshot } from "../../lib/pulse/pulseHub";
import { Reveal } from "../../motion/Reveal";
import { Tag } from "../../ui/Badge";
import { ButtonLink } from "../../ui/Button";
import { daysUntil, MAINNET_AT } from "./model";

const selectBlockMs = (s: PulseSnapshot) => (s.pulse ? Math.round(s.pulse.blockTimeMs) : null);
const selectGas = (s: PulseSnapshot) => s.pulse?.gasPriceGwei ?? s.head?.baseFeeGwei ?? null;

function Fact({ value, unit, label, note }: { readonly value: string; readonly unit?: string; readonly label: string; readonly note: string }) {
  return (
    <div className="flex flex-col gap-2 bg-card px-4 py-5 sm:px-5 sm:py-6">
      <p className="caption">{label}</p>
      <p className="tnum font-mono text-[30px] font-medium leading-none tracking-[-0.02em] text-ink sm:text-[48px]">
        {value}
        {unit ? <span className="ml-1 text-[14px] text-ink-2 sm:ml-1.5 sm:text-[18px]">{unit}</span> : null}
      </p>
      <p className="text-[13px] leading-snug text-ink-2 sm:text-[14px]">{note}</p>
    </div>
  );
}

/** Elysium in four numbers: block time and gas measured live, the chain ids, the mainnet date. */
export function ElysiumFacts() {
  const blockMs = usePulseSelector(selectBlockMs);
  const gas = usePulseSelector(selectGas);
  const now = useNow(60_000);
  const days = daysUntil(MAINNET_AT, now);
  return (
    <section aria-labelledby="elysium-title" className="mx-auto max-w-[1440px] px-4 pb-20 sm:px-6 lg:px-10 lg:pb-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <Reveal className="flex flex-col gap-6">
          <Tag className="self-start">The summit · Elysium</Tag>
          <h2 id="elysium-title" className="text-[40px] font-bold leading-[1.02] tracking-[-0.02em] text-balance sm:text-[56px]">
            Built on the fastest summit in the range.
          </h2>
          <p className="max-w-[34rem] text-[18px] leading-relaxed text-ink-2">
            Elysium settles to HyperEVM, which sits next to HyperCore&apos;s order books. Elyia ropes the three together: one sentence can start on the Floor and finish on the Summit.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={routeHref("elysium")} variant="ink" size="lg">
              Read the weather station →
            </ButtonLink>
            <ButtonLink to={routeHref("bridge")} variant="ghost" size="lg">
              Bridge up
            </ButtonLink>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div className="grid grid-cols-2 gap-[2px] border-2 border-rule bg-rule shadow-hard-xl">
            <Fact value={blockMs !== null ? String(blockMs) : "114"} unit="ms" label={blockMs !== null ? "Block time · measured now" : "Block time · nominal"} note="Roughly nine blocks a second. Your fills land before you blink." />
            <Fact value={gas !== null ? formatGwei(gas, { unit: false }) : "0.1"} unit="gwei" label={gas !== null ? "Gas · base fee now" : "Gas · base fee floor"} note="Paid in HYPE. The floor is 0.1 gwei; a plain transfer costs a fraction of a cent." />
            <Fact value="99801" label="Chain · testnet" note="The practice wall. Separate capital, same rules. Mainnet is chain 99901." />
            <Fact value={days > 0 ? String(days) : "Open"} unit={days > 0 ? (days === 1 ? "day" : "days") : undefined} label="Mainnet · 9 Nov 2026" note={days > 0 ? "Until the mainnet summit opens. Elyia switches on with it." : "The mainnet summit is open."} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
