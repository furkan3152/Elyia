import { useEffect, useState } from "react";

import { usePulseFeed } from "../../hooks/usePulse";
import { useChangeKey } from "../../motion/useChangeKey";
import { cssVars } from "../../motion/tokens";
import { Altimeter } from "../../topo/Altimeter";
import { AvalancheBulletin } from "../../topo/AvalancheBulletin";
import { Barograph } from "../../topo/Barograph";
import { Blaze } from "../../topo/Blaze";
import { ConditionSign } from "../../topo/ConditionSign";
import { ContourField, Grain } from "../../topo/ContourField";
import { ElevationProfile } from "../../topo/ElevationProfile";
import { GuideLicence } from "../../topo/GuideLicence";
import { HutStamp } from "../../topo/HutStamp";
import { MapKey, MapSheet, NorthArrow, ScaleBar } from "../../topo/MapSheet";
import { KeySwatch } from "../../topo/keySwatch";
import { RadioLog } from "../../topo/RadioLog";
import { Relief } from "../../topo/Relief";
import { Rope } from "../../topo/Rope";
import { RouteCard } from "../../topo/RouteCard";
import { SignpostCluster } from "../../topo/Signpost";
import { SummitRegister } from "../../topo/SummitRegister";
import { Weather } from "../../topo/Weather";
import { Windsock } from "../../topo/Windsock";
import { Button } from "../../ui/Button";
import { Panel, PanelHeader } from "../../ui/Panel";
import { KeySection, Specimen } from "./KeySection";
import { SAMPLE_CAMPS, SAMPLE_EQUITY, SAMPLE_HOLDINGS, SAMPLE_RADIO, SAMPLE_REGISTER, SAMPLE_SHOCK, SAMPLE_STEPS } from "./samples";

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const SAMPLE_NOW = Date.UTC(2026, 9, 29, 14, 2);

function LiveAltimeter() {
  const [value, setValue] = useState(48_213);
  useEffect(() => {
    const timer = window.setInterval(() => setValue((v) => v + Math.round((Math.sin(v) + 0.3) * 7)), 2600);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <Altimeter value={usd(value)} label="Net worth (sample)" size="lg" markLatest />
      <p className="tnum font-mono text-[13px] text-ink-2">
        <span className="text-up">▲ +$1,204 today</span> · <span className="text-up">▲▲ +22.2%</span> · 35 days
      </p>
      <Altimeter value={(18_514_484 + Math.floor((value - 48_213) * 1.7)).toLocaleString("en-US")} label="Summit head (sample)" variant="inline" size="md" />
    </div>
  );
}

function StampBench() {
  const [press, setPress] = useState(0);
  const key = useChangeKey(press);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <HutStamp key={`a${key}`} layer="floor" block="41,077,288" time="14:02:11" animate={key > 0} />
      <HutStamp key={`b${key}`} layer="ridge" block="41,077,312" time="14:02:13" state="signed" animate={key > 0} delayMs={140} />
      <HutStamp key={`c${key}`} layer="summit" block="18,514,920" time="14:05:40" state="refused" animate={key > 0} delayMs={280} />
      <Button variant="ink" size="sm" onClick={() => setPress((n) => n + 1)}>
        Stamp again
      </Button>
    </div>
  );
}

function RopeBench() {
  const [mark, setMark] = useState(4072);
  return (
    <div className="grid grid-cols-1 gap-6">
      <Panel>
        <PanelHeader title="ETH 5× long · rope 19% · sample" aside={<Weather weather="few" showLabel />} />
        <Rope symbol="ETH" side="long" entry={3950} mark={mark} liquidation={3298} stop={3600} takeProfit={4600} />
        <label className="mt-3 flex items-center gap-3 font-mono text-xs text-ink-2">
          Move the mark
          <input type="range" min={3320} max={4560} value={mark} onChange={(event) => setMark(Number(event.target.value))} className="el-range max-w-xs" aria-label="Sample mark price" style={cssVars({ "--el-range-fill": `${((mark - 3320) / 1240) * 100}%` })} />
          <span className="tnum text-ink">{mark.toLocaleString("en-US")}</span>
        </label>
      </Panel>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Panel>
          <PanelHeader title="FARTCOIN 3× short · fraying · sample" aside={<Windsock fundingApr={0.32} />} />
          <Rope symbol="FARTCOIN" side="short" entry={1.0} mark={1.06} liquidation={1.124} stop={1.092} takeProfit={0.82} />
        </Panel>
        <Panel>
          <PanelHeader title="HYPE 10× long · no flag · critical" aside={<Weather weather="storm" />} />
          <Rope symbol="HYPE" side="long" entry={41.2} mark={40.1} liquidation={38.4} />
        </Panel>
      </div>
      <Panel padding="sm">
        <PanelHeader title="Compact (table row)" className="mb-2" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Rope variant="compact" symbol="ETH" side="long" entry={3950} mark={4072} liquidation={3298} takeProfit={4600} />
          <Rope variant="compact" symbol="FART" side="short" entry={1} mark={1.06} liquidation={1.124} />
          <Rope variant="compact" symbol="HYPE" side="long" entry={30} mark={40} />
        </div>
      </Panel>
    </div>
  );
}

export function ArtifactsSection() {
  const feed = usePulseFeed();
  const [quoteExpiry] = useState(() => Date.now() + 41_000);
  return (
    <>
      <KeySection id="relief" number="12" title="Relief · map sheet" description="Your money as terrain: hills are holdings (height = USD), shorts are dashed basins, cliffs mark leverage, the three layers are regions. Contours draw on as the sheet scrolls into view." importLine='import { Relief, MapSheet, MapKey, ScaleBar, NorthArrow } from "src/topo"'>
        <MapSheet
          label="Portfolio relief · HyperCore + HyperEVM + Elysium · sample"
          elevation={
            <>
              NET WORTH <b className="text-sm text-ink">$48,213</b> <span className="text-up">▲ +$1,204</span>
            </>
          }
          titleBlock={{ name: "Sheet 03 · Your range", date: "29 OCT 2026", mode: "testnet" }}
          furniture={
            <>
              <MapKey
                items={[
                  { swatch: KeySwatch.line("rgb(var(--contour))"), label: "holding · $800 contours" },
                  { swatch: KeySwatch.line("rgb(var(--down))", true), label: "short basin ($400)" },
                  { swatch: KeySwatch.peak(), label: "peak = position" },
                ]}
              />
              <ScaleBar labels={["0", "$5k", "$10k"]} label="Scale: one bar is $5,000 of height" />
              <NorthArrow />
            </>
          }
        >
          <Relief holdings={SAMPLE_HOLDINGS} furniture={false} />
        </MapSheet>
      </KeySection>

      <KeySection id="route" number="13" title="Route card · signposts · hut stamp" description="An intent is a laminated route card: steps climb Floor → Ridge → Summit, settled steps get a hut stamp, the stub keeps fees, signatures, the quote countdown and the Rule Book. Signposts swing in from the pole." importLine='import { RouteCard, SignpostCluster, HutStamp } from "src/topo"'>
        <div className="grid grid-cols-1 gap-10">
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
              { step: "W1", text: "ledger update on the Floor matches 1,000 USDC to 0x7a3e…3f2c · nonce 1730210531", proven: true },
              { step: "W2", text: "receipt 0x5e1c…9a04 · Swap log amountOut 11.94 ≥ bound 11.88", proven: true },
              { step: "W3", text: "waits for its receipt, then the kHYPE Transfer log is read back", proven: false },
            ]}
            action={
              <Button variant="primary" size="lg" fullWidth grade={2}>
                Sign W4 · ascend
              </Button>
            }
            note="Pool prices on the practice wall are not market prices; quotes show the HyperCore reference."
          />
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
            <SignpostCluster
              caption="The junction · 3 routes surveyed · sample"
              blades={[
                { destination: "Via HyperSwap + Kalos", eta: "4 min", detail: "$5.29 · 4 signatures · best value", grade: 2, chosen: true, onClick: () => undefined },
                { destination: "Via Dex Da Costa", eta: "5 min", detail: "$6.10 · wraps its own WETH", grade: 3, highlight: false, onClick: () => undefined },
                { destination: "Stay on the Ridge", eta: "1 min", detail: "kHYPE only · $0.25", grade: 1, highlight: false, onClick: () => undefined },
              ]}
            />
            <SignpostCluster
              caption="Wayfinding"
              blades={[
                { destination: "Elysium · bridge", eta: "5 s", grade: 2 },
                { destination: "Swap · USDC", eta: "0.3 s", grade: 1, highlight: false },
                { destination: "Floor · perps", grade: 4, direction: "left", highlight: false },
              ]}
            />
          </div>
        </div>
        <div className="mt-8">
          <Specimen label="Hut stamps · settled, signed, refused (thump once, on a real change)">
            <StampBench />
          </Specimen>
        </div>
      </KeySection>

      <KeySection id="rope" number="14" title="The rope · weather · windsock" description="Each position is a rope: crevasse ✕ (liquidation), anchor (stop), climber (mark), entry tick, flag (take-profit). It frays under 10% and pulses slowly under 5%. Funding is a windsock, volatility is the weather." importLine='import { Rope, Windsock, Weather } from "src/topo"'>
        <RopeBench />
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Panel>
            <PanelHeader title="Windsock · funding" />
            <ul className="flex flex-col gap-2.5">
              <li>
                <Windsock fundingApr={0} showLabel />
              </li>
              <li>
                <Windsock fundingApr={0.11} showLabel />
              </li>
              <li>
                <Windsock fundingApr={-0.24} showLabel />
              </li>
              <li>
                <Windsock fundingApr={0.62} showLabel />
              </li>
            </ul>
          </Panel>
          <Panel>
            <PanelHeader title="Weather · realised volatility" />
            <ul className="grid grid-cols-2 gap-3">
              <li>
                <Weather weather="clear" showLabel detail="22nd pct" />
              </li>
              <li>
                <Weather weather="few" showLabel detail="51st pct" />
              </li>
              <li>
                <Weather weather="overcast" showLabel detail="79th pct" />
              </li>
              <li>
                <Weather weather="storm" showLabel detail="96th pct" />
              </li>
            </ul>
          </Panel>
        </div>
      </KeySection>

      <KeySection id="profile" number="15" title="Elevation profile · altimeter" description="Equity as a ridgeline: hatched rock, camps for key events, the summit flag at the all-time high and the valley at the deepest drawdown. The altimeter rolls only the digits that changed." importLine='import { ElevationProfile, Altimeter } from "src/topo"'>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel>
            <PanelHeader title="Elevation profile · equity · 35 days · sample" />
            <ElevationProfile series={SAMPLE_EQUITY} camps={SAMPLE_CAMPS} label="Sample equity over 35 days, from $39,449 to $48,213" caption="a 35-day climb · +$8,764 · +22.2%" startLabel="SEP 24" endLabel="TODAY" />
          </Panel>
          <Panel>
            <PanelHeader title="Altimeter · net worth · sample" />
            <LiveAltimeter />
          </Panel>
        </div>
      </KeySection>

      <KeySection id="avalanche" number="16" title="Avalanche bulletin · shock slider" description="Portfolio risk on the 1–5 scale with one line of advice. Drag the shock and every rope is recomputed: which fray, which snap, what your net worth becomes." importLine='import { AvalancheBulletin } from "src/topo"'>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <AvalancheBulletin positions={SAMPLE_SHOCK} netWorth={48_213} concentration={0.42} action={(shock) => <Button variant="primary" disabled={shock === 0}>Plan the hedge</Button>} />
          <Panel>
            <PanelHeader title="Blazes · route conditions" />
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-5">
                {([1, 2, 3, 4, 5, 6] as const).map((grade) => (
                  <Blaze key={grade} grade={grade} size={22} showGrade />
                ))}
              </div>
              <p className="text-sm text-ink-2">Yellow diamond: T1–T2 trail (swap, stake, bridge). White-red-white: T3–T4 mountain (perps up to 10×). White-blue-white: T5–T6 alpine (over 10×, unverified tokens).</p>
              <div className="flex flex-col gap-2.5">
                <ConditionSign condition="open" score={86} reason="liquidity locked 12 months" />
                <ConditionSign condition="caution" score={54} reason="owner can pause transfers" />
                <ConditionSign condition="closed" score={12} reason="honeypot: sells revert" />
              </div>
            </div>
          </Panel>
        </div>
      </KeySection>

      <KeySection id="guide" number="17" title="Guide's licence · radio · register" description="Keeper mode is a permit: punched days, printed limits, TRADE ONLY · CANNOT WITHDRAW, and a VOID tear on revoke. The agent talks over base-camp radio; activity is a summit register." importLine='import { GuideLicence, RadioLog, SummitRegister } from "src/topo"'>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <GuideLicence
            sample
            agent="0x9c2b7e41aa3f0b6c2d91e5f04c3a1b8e9f2d41d0"
            holder="0x7a3e5b2c91d04f6e8a7b3c2d1e0f9a8b7c6d3f2c"
            markets={["FARTCOIN", "ETH", "HYPE"]}
            actions={["order", "cancel", "modify"]}
            limits={[
              ["Per order", "≤ $5,000 · ≤ 5× · reduce-only at night"],
              ["Day loss cap", "$400 → licence suspends itself"],
            ]}
            validFrom={SAMPLE_NOW - 7 * 86_400_000}
            validUntil={SAMPLE_NOW + 23 * 86_400_000}
            now={SAMPLE_NOW}
            footer={
              <>
                <Button variant="primary" grade={3}>
                  Issue · sign in wallet
                </Button>
                <Button variant="danger">Void</Button>
              </>
            }
          />
          <GuideLicence
            sample
            revoked
            agent="0x41d02b9c7e41aa3f0b6c2d91e5f04c3a1b8e9f2d"
            holder="0x7a3e5b2c91d04f6e8a7b3c2d1e0f9a8b7c6d3f2c"
            markets={["ETH"]}
            actions={["order", "cancel"]}
            limits={[["Per order", "≤ $1,000 · ≤ 3×"]]}
            validFrom={SAMPLE_NOW - 12 * 86_400_000}
            validUntil={SAMPLE_NOW + 2 * 86_400_000}
            now={SAMPLE_NOW}
          />
          <RadioLog entries={SAMPLE_RADIO} aside="→ Telegram ✓" footer="next · W4 needs your signature, then the ticket watch takes over" className="lg:col-span-2" />
          <SummitRegister rows={SAMPLE_REGISTER} caption="Sample activity register" className="lg:col-span-2" />
        </div>
      </KeySection>

      <KeySection id="barograph" number="18" title="Barograph · ground" description="Elysium's ~114 ms blocks as a fine ink trace on a paper drum: one kick per block, taller with more transactions. A thin strip, never a hero. Under the pages lies a very faint, still contour ground." importLine='import { Barograph, ContourField, Grain } from "src/topo"'>
        <div className="grid grid-cols-1 gap-6">
          <Barograph feed={feed} />
          <Barograph height={44} />
          <div className="relative h-48 overflow-hidden border-2 border-rule bg-paper">
            <ContourField seed={5} strength={2.2} />
            <Grain />
            <p className="absolute bottom-3 left-3 border-2 border-rule bg-card px-2 py-1 font-mono text-[11px] text-ink-2">ContourField (strength 2.2) + Grain</p>
          </div>
        </div>
      </KeySection>
    </>
  );
}
