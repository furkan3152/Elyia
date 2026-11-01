import { useEffect, useState } from "react";

import { usePulseFeed } from "../../hooks/usePulse";
import { useChangeKey } from "../../motion/useChangeKey";
import { Cards, Section, Split } from "../../pixel/layout";
import { PixelAltimeter } from "../../pixel/PixelAltimeter";
import { PixelBarograph } from "../../pixel/PixelBarograph";
import { PixelProfile } from "../../pixel/PixelProfile";
import { PixelRope } from "../../pixel/PixelRope";
import { PixelStamp } from "../../pixel/PixelStamp";
import { AvalancheBulletin } from "../../topo/AvalancheBulletin";
import { Blaze } from "../../topo/Blaze";
import { ConditionSign } from "../../topo/ConditionSign";
import { GuideLicence } from "../../topo/GuideLicence";
import { RadioLog } from "../../topo/RadioLog";
import { RouteCard } from "../../topo/RouteCard";
import { SignpostCluster } from "../../topo/Signpost";
import { SummitRegister } from "../../topo/SummitRegister";
import { Weather } from "../../topo/Weather";
import { Windsock } from "../../topo/Windsock";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Panel, PanelHeader } from "../../ui/Panel";
import { Slider } from "../../ui/Slider";
import { ImportLine, Specimen } from "./KeySection";
import { SAMPLE_CAMPS, SAMPLE_EQUITY, SAMPLE_RADIO, SAMPLE_REGISTER, SAMPLE_SHOCK, SAMPLE_STEPS } from "./samples";

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const SAMPLE_NOW = Date.UTC(2026, 9, 29, 14, 2);

function LiveAltimeter() {
  const [value, setValue] = useState(48_213);
  useEffect(() => {
    const timer = window.setInterval(() => setValue((v) => v + Math.round((Math.sin(v) + 0.3) * 23)), 2400);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col items-center gap-5">
      <PixelAltimeter value={usd(value)} label="Net worth (sample)" size="lg" markLatest />
      <p className="tnum font-mono text-[13px] text-ink-2">
        <span className="text-up">▲ +$1,204 today</span> · <span className="text-up">▲ +22.2%</span> · 35 days
      </p>
      <PixelAltimeter value={(18_514_484 + Math.floor((value - 48_213) * 1.7)).toLocaleString("en-US")} label="Summit head (sample)" variant="inline" size="md" />
    </div>
  );
}

function StampBench() {
  const [press, setPress] = useState(0);
  const key = useChangeKey(press);
  return (
    <div className="flex flex-col items-center gap-8">
      <div className="flex flex-wrap items-center justify-center gap-8">
        <PixelStamp key={`a${key}`} state="settled" detail="FLOOR · #41,077,288" animate={key > 0} />
        <PixelStamp key={`b${key}`} state="signed" detail="RIDGE · 14:02:13" animate={key > 0} delayMs={140} />
        <PixelStamp key={`c${key}`} state="queued" detail="SUMMIT · ~3 MIN" animate={key > 0} delayMs={280} />
        <PixelStamp key={`d${key}`} state="refused" detail="RULE BOOK · SLIPPAGE" animate={key > 0} delayMs={420} />
      </div>
      <Button variant="ink" size="sm" onClick={() => setPress((n) => n + 1)}>
        Stamp again
      </Button>
    </div>
  );
}

function RopeBench() {
  const [mark, setMark] = useState(4072);
  return (
    <div className="flex w-full flex-col gap-6">
      <PixelRope symbol="ETH" side="long" entry={3950} mark={mark} liquidation={3298} stop={3600} takeProfit={4600} />
      <Slider label="Move the mark (sample)" value={mark} onChange={setMark} min={3320} max={4560} format={(value) => value.toLocaleString("en-US")} />
    </div>
  );
}

function LiveBarograph() {
  const feed = usePulseFeed();
  return <PixelBarograph feed={feed} height={96} readout="Elysium testnet · ~114 ms" />;
}

/** 05 · The pixel kit: ropes, altimeters, stamps, route cards, profiles, bulletins, licences and glyphs. */
export function ArtifactsSection() {
  const [quoteExpiry] = useState(() => Date.now() + 42_000);
  return (
    <Section id="kit" tag="05 · Interface kit · drawn artifacts" title="The same pixel, on every screen." lede="Ropes, route cards, altimeters and stamps are drawn with the same 4 px line: stepped corners, tone lines instead of ink, colour = altitude.">
      <ImportLine>{'import { PixelRope, PixelAltimeter, PixelStamp, PixelProfile, PixelBarograph } from "src/pixel"'}</ImportLine>

      <Split>
        <Specimen label="Rope · ETH 5× long · 19% to the crevasse" note="Liquidation ✕ to the flag; Ely climbs at the live mark. Under 10% the rope frays and Ely worries." align="stretch">
          <RopeBench />
        </Specimen>
        <Specimen label="Altimeter · net worth" note="Pixel digit blocks. Only the digits that change roll, in four steps, lit in sun yellow.">
          <LiveAltimeter />
        </Specimen>
      </Split>

      <div className="mt-7">
        <Split>
          <Specimen label="Fraying · FARTCOIN 3× short · 6%" align="stretch">
            <PixelRope symbol="FARTCOIN" side="short" entry={1.02} mark={1.06} liquidation={1.124} stop={1.1} />
          </Specimen>
          <Specimen label="Compact ropes · for table rows" align="stretch">
            <div className="flex flex-col gap-4">
              <PixelRope variant="compact" symbol="HYPE" side="long" entry={38} mark={40.12} liquidation={26.8} takeProfit={48} />
              <PixelRope variant="compact" symbol="FARTCOIN" side="short" entry={1.02} mark={1.06} liquidation={1.124} />
            </div>
          </Specimen>
        </Split>
      </div>

      <div className="mt-14">
        <RouteCard
          id="7F3A"
          sample
          sentence="ascend 1,000 USDC: half to kHYPE, half to the Kalos HYPE pool on Elysium, keep gas"
          grade={2}
          steps={SAMPLE_STEPS}
          fees="$5.29"
          signatures={{ done: 2, needed: 4, note: "W2+W3 batched" }}
          quote={{ expiresAt: quoteExpiry, boundTo: "SUMMIT #18,514,920" }}
          rules={["slippage ≤ 1%", "venues on the list", "exact approvals", "to your own address", "day cap $5,000"]}
          binding="sha256:350c68af…"
          evidence={[
            { step: "W1", text: "ledger update on the Floor matches 1,000 USDC · nonce 1730210531", proven: true },
            { step: "W2", text: "receipt 0x5e1c…9a04 · amountOut 11.94 ≥ bound 11.88", proven: true },
            { step: "W3", text: "waits for its receipt, then the kHYPE Transfer log is read back", proven: false },
          ]}
          action={
            <>
              <Button fullWidth>Sign W4 · ascend</Button>
              <Button variant="ink" fullWidth>
                Save as a recipe
              </Button>
            </>
          }
          note="You sign every step in your own wallet."
        />
      </div>

      <div className="mt-14">
        <Specimen label="Stamps · thump once, on a real change" note="SETTLED in rope red, SIGNED in green, QUEUED in glacier, REFUSED in ink.">
          <StampBench />
        </Specimen>
      </div>

      <div className="mt-14">
        <Panel padding="lg">
          <PanelHeader title="Profile · net worth · 35 days · sample" aside={<Badge tone="signal" variant="solid">Sample</Badge>} />
          <PixelProfile series={SAMPLE_EQUITY} camps={SAMPLE_CAMPS} label="Net worth over 35 days, sample: from $39,449 to $48,213, worst drop shown as a lake" height={60} startLabel="SEP 24" endLabel="TODAY" caption="a 35-day climb · +$8,764" />
        </Panel>
      </div>

      <div className="mt-14">
        <Panel padding="lg">
          <PanelHeader title="Barograph · Elysium · one tick per block" />
          <LiveBarograph />
        </Panel>
      </div>

      <div className="mt-14">
        <Split>
          <AvalancheBulletin positions={SAMPLE_SHOCK} netWorth={48_213} concentration={0.42} action={(shock) => <Button disabled={shock === 0}>Plan the hedge</Button>} />
          <GuideLicence
            sample
            agent="0x9c2b7e41aa3f0b6c2d91e5f04c3a1b8e9f2d41d0"
            holder="0x7a3e5b2c91d04f6e8a7b3c2d1e0f9a8b7c6d3f2c"
            markets={["FARTCOIN", "ETH", "HYPE"]}
            actions={["order", "cancel", "modify"]}
            limits={[
              ["Per order", "≤ $5,000 · ≤ 5×"],
              ["Day loss cap", "$400 → suspends itself"],
            ]}
            validFrom={SAMPLE_NOW - 7 * 86_400_000}
            validUntil={SAMPLE_NOW + 23 * 86_400_000}
            now={SAMPLE_NOW}
            footer={
              <>
                <Button variant="danger" size="sm">
                  Void the licence
                </Button>
                <span className="font-tag text-[11px] uppercase text-ink-2">Trade-only key · no withdrawals</span>
              </>
            }
          />
        </Split>
      </div>

      <div className="mt-14">
        <Split>
          <RadioLog entries={SAMPLE_RADIO} aside="→ Telegram ✓" footer="next · W4 needs your signature" className="h-full" />
          <Specimen label="Signposts · wayfinding" align="stretch">
            <SignpostCluster
              caption="The junction · 3 routes surveyed · sample"
              blades={[
                { destination: "Via HyperSwap + Kalos", eta: "4 min", detail: "$5.29 · 4 signatures · best value", grade: 2, chosen: true, onClick: () => undefined },
                { destination: "Via Dex Da Costa", eta: "5 min", detail: "$6.10 · wraps its own WETH", grade: 3, highlight: false, onClick: () => undefined },
                { destination: "Stay on the Ridge", eta: "1 min", detail: "kHYPE only · $0.25", grade: 1, highlight: false, onClick: () => undefined },
              ]}
            />
          </Specimen>
        </Split>
      </div>

      <div className="mt-14">
        <SummitRegister rows={SAMPLE_REGISTER} caption="Sample activity register" />
      </div>

      <h3 className="mb-8 mt-16 text-center font-display text-[28px] font-bold text-ink">Pixel glyphs</h3>
      <Cards n={4}>
        <Specimen label="Weather · volatility">
          <div className="flex flex-col items-start gap-3">
            <Weather weather="clear" size={26} showLabel />
            <Weather weather="few" size={26} showLabel />
            <Weather weather="overcast" size={26} showLabel />
            <Weather weather="storm" size={26} showLabel />
          </div>
        </Specimen>
        <Specimen label="Windsock · funding">
          <div className="flex flex-col items-start gap-3">
            <Windsock fundingApr={0.32} size={24} showLabel />
            <Windsock fundingApr={0.11} size={24} showLabel />
            <Windsock fundingApr={-0.18} size={24} showLabel />
            <Windsock fundingApr={0} size={24} showLabel />
          </div>
        </Specimen>
        <Specimen label="Blazes · route grades">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {([1, 2, 3, 4, 5, 6] as const).map((grade) => (
              <Blaze key={grade} grade={grade} size={18} showGrade />
            ))}
          </div>
        </Specimen>
        <Specimen label="Condition signs · Shield">
          <div className="flex flex-col items-center gap-4">
            <ConditionSign condition="open" score={86} />
            <ConditionSign condition="caution" score={54} />
            <ConditionSign condition="closed" score={12} />
          </div>
        </Specimen>
      </Cards>
    </Section>
  );
}
