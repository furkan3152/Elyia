import { Ely } from "../../pixel/Ely";
import { ElyEmpty } from "../../pixel/ElyEmpty";
import { ElyLoader } from "../../pixel/ElyLoader";
import { ElyToast } from "../../pixel/ElyToast";
import { Cards, Section } from "../../pixel/layout";
import { STATE_MEANING, type ElyState } from "../../pixel/states";
import { Button } from "../../ui/Button";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/toast";
import { ImportLine, Specimen } from "./KeySection";

const GRID_STATES: readonly ElyState[] = ["idle", "climb", "summit", "worry", "sleep", "watch"];

function StateCard({ state }: { readonly state: ElyState }) {
  const meaning = STATE_MEANING[state];
  return (
    <Panel as="article" padding="lg" className="flex h-full flex-col items-center text-center">
      <Ely state={state} size={176} />
      <h3 className="mt-4 font-display text-[22px] font-bold text-ink">{meaning.title}</h3>
      <p className="mt-1.5 text-sm text-ink-2">{meaning.detail}</p>
      <p className="mt-3 font-tag text-[11px] uppercase text-summit-ink">{meaning.where}</p>
      <code className="mt-3 font-mono text-xs text-ink-3">{`<Ely state="${state}" />`}</code>
    </Panel>
  );
}

/** 02 · Ely speaks the state. */
export function ElySection() {
  return (
    <Section id="ely" tag="02 · Ely · six states and a voice" title="Ely says the state." lede="Loading, success, danger, empty, night: every important moment has a sprite, so the state reads before the number. Ely is purposeful, never decoration.">
      <ImportLine>{'import { Ely, ElyLoader, ElyEmpty, ElyToast } from "src/pixel"'}</ImportLine>
      <Cards n={3}>
        {GRID_STATES.map((state) => (
          <StateCard key={state} state={state} />
        ))}
      </Cards>
      <h3 className="mb-8 mt-16 text-center font-display text-[28px] font-bold text-ink">Ely in the interface</h3>
      <Cards n={3}>
        <Specimen label="ElyLoader · replaces spinners" note="Ely climbs the rope while something is in flight. The label is a polite status.">
          <ElyLoader label="Reading the order book" size="lg" />
        </Specimen>
        <Specimen label="ElyEmpty · empty states" note="Asleep by the hut: what is missing, in plain words, and one next step.">
          <ElyEmpty compact title="No positions yet" description="Open one from the terminal and its rope appears here." action={<Button size="sm">Open trade</Button>} />
        </Specimen>
        <Specimen label="Talk · the Guide speaking" note="The mouth flaps while the Guide has something to say.">
          <Ely state="talk" size={132} />
          <p className="mt-3 max-w-[260px] bg-card px-3 py-2 text-left font-mono text-[13px] text-ink px-frame-thin">“ETH funding flipped: your long now pays 11% APR.”</p>
        </Specimen>
      </Cards>
      <div className="mx-auto mt-12 flex max-w-[860px] flex-col items-center gap-8">
        <div className="w-full max-w-[460px]">
          <ElyToast pop={false} tone="success" from="FLOOR" time="14:02:11" title="W1 settled · 1,000 USDC on the Ridge" description="Hut stamp pressed. Block 41,077,288." />
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-7">
          <Button variant="ink" onClick={() => toast({ title: "Route 7F3A planned", description: "Quote bound to SUMMIT #18,514,920.", from: "GUIDE" })}>
            Radio a note
          </Button>
          <Button variant="ink" onClick={() => toast({ title: "W2 settled", description: "11.94 HYPE · tx 0x5e1c…9a04", tone: "success", from: "RIDGE" })}>
            Radio a success
          </Button>
          <Button variant="danger" onClick={() => toast({ title: "FARTCOIN rope 6%", description: "Fraying: 6% to liquidation.", tone: "warning", from: "ALERT" })}>
            Radio a warning
          </Button>
        </div>
      </div>
    </Section>
  );
}
