import { Copy, Plus } from "lucide-react";
import { useState } from "react";

import { Cards, Section, Split } from "../../pixel/layout";
import { gradeFor } from "../../topo/geometry/conditions";
import { Badge, Chip, GradeChip, LayerChip, Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable, type DataColumn } from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { KbdCombo } from "../../ui/Kbd";
import { NumberField } from "../../ui/NumberInput";
import { Panel, PanelHeader } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { SkeletonText } from "../../ui/Skeleton";
import { Slider } from "../../ui/Slider";
import { Tabs } from "../../ui/Tabs";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { WhereToInput } from "../../ui/WhereToInput";
import { ImportLine, Specimen } from "./KeySection";

interface MarketRow {
  readonly coin: string;
  readonly mark: number;
  readonly change: number;
  readonly funding: number;
}

const ROWS: readonly MarketRow[] = [
  { coin: "HYPE", mark: 40.12, change: 0.034, funding: 0.11 },
  { coin: "ETH", mark: 4072.5, change: -0.012, funding: -0.04 },
  { coin: "BTC", mark: 112_480, change: 0.006, funding: 0.08 },
  { coin: "FARTCOIN", mark: 1.06, change: -0.081, funding: 0.32 },
];

const COLUMNS: readonly DataColumn<MarketRow>[] = [
  { id: "coin", header: "Market", cell: (row) => <span className="font-tag text-[12px]">{row.coin}</span>, sortValue: (row) => row.coin, firstSort: "asc" },
  { id: "mark", header: "Mark", align: "right", cell: (row) => row.mark.toLocaleString("en-US", { maximumFractionDigits: 2 }), sortValue: (row) => row.mark },
  {
    id: "change",
    header: "24 h",
    align: "right",
    cell: (row) => (
      <span className={row.change < 0 ? "text-down" : "text-up"}>
        {row.change < 0 ? "▼" : "▲"} {(Math.abs(row.change) * 100).toFixed(1)}%
      </span>
    ),
    sortValue: (row) => row.change,
  },
  { id: "funding", header: "Funding APR", align: "right", cell: (row) => `${(row.funding * 100).toFixed(0)}%`, sortValue: (row) => row.funding },
];

/** 06 · Primitives: buttons, labels, panels, controls, fields, overlays, the log book. */
export function PrimitivesSection() {
  const [loading, setLoading] = useState(false);
  const [segment, setSegment] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState<"market" | "limit" | "twap">("market");
  const [amount, setAmount] = useState("250");
  const [leverage, setLeverage] = useState(5);
  const [toggle, setToggle] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [where, setWhere] = useState("ascend 1,000 USDC: half to kHYPE, half to the Kalos pool");

  return (
    <Section id="primitives" tag="06 · Primitives · src/ui" title="Game buttons, tone frames." lede="Every primitive keeps its props and gains the pixel: buttons are bevelled like a retro game (light top-left, dark bottom-right, stepped corners), cards sit in a thin tone line with a depth band, Pixelify labels, and a dashed sun outline for focus.">
      <ImportLine>{'import { Button, Panel, Tabs, Slider, Toggle, Input, Dialog, toast } from "src/ui"'}</ImportLine>

      <Split>
        <Specimen label="Buttons · variants" note="One primary per view. Hover lifts 2 px, press pushes 2 px.">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-7">
            <Button rightIcon={<span aria-hidden="true">→</span>}>Open the deck</Button>
            <Button variant="ink">Try a route</Button>
            <Button variant="solid-ink">Set anchor</Button>
            <Button variant="signpost">Elysium ▶</Button>
            <Button variant="danger">Kill switch</Button>
            <Button variant="ghost">Cancel</Button>
          </div>
        </Specimen>
        <Specimen label="Sides · grades · sizes · states" note="Trade sides carry ▲ ▼ and the grade blaze; loading never spins.">
          <div className="flex flex-col items-center gap-7">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-7">
              <Button variant="long" grade={gradeFor({ kind: "perp", leverage: 3 })}>
                Long ▲
              </Button>
              <Button variant="short" grade={gradeFor({ kind: "perp", leverage: 20 })}>
                Short ▼
              </Button>
              <Button
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  window.setTimeout(() => setLoading(false), 2400);
                }}
              >
                {loading ? "Reading" : "Sign W4"}
              </Button>
              <Button disabled>Expired</Button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-7">
              <Button size="xs" variant="ink">
                xs
              </Button>
              <Button size="sm" variant="ink">
                sm
              </Button>
              <Button size="md" variant="ink">
                md
              </Button>
              <Button size="lg" variant="ink">
                lg
              </Button>
              <IconButton label="Copy address" icon={<Copy className="h-4 w-4" aria-hidden="true" />} variant="ink" />
              <IconButton label="Add" icon={<Plus className="h-4 w-4" aria-hidden="true" />} variant="primary" />
            </div>
          </div>
        </Specimen>
      </Split>

      <Cards n={3} className="mt-7">
        <Specimen label="Tags · layers · grades">
          <div className="flex flex-col items-center gap-4">
            <Tag>Route card 7F3A · grade T2</Tag>
            <div className="flex flex-wrap justify-center gap-4">
              <LayerChip layer="floor" />
              <LayerChip layer="ridge" />
              <LayerChip layer="summit" />
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <LayerChip layer="summit" variant="solid" network />
              <GradeChip grade={3} />
            </div>
          </div>
        </Specimen>
        <Specimen label="Badges · chips · keys">
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-wrap justify-center gap-3">
              <Badge tone="up" dot="pulse">
                Live
              </Badge>
              <Badge tone="signal" variant="solid">
                Sample
              </Badge>
              <Badge tone="down" variant="outline">
                ▼ 3.5%
              </Badge>
              <Badge tone="accent">Summit</Badge>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <Chip selected>Perps</Chip>
              <Chip>Spot</Chip>
              <Chip mono>“long HYPE 3x”</Chip>
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              <KbdCombo keys={["mod", "K"]} />
              <KbdCombo keys={["g", "t"]} joiner="then" />
            </div>
          </div>
        </Specimen>
        <Specimen label="Toggle · segmented">
          <div className="flex flex-col items-center gap-5">
            <Toggle checked={toggle} onChange={setToggle} label="Keeper mode" description={toggle ? "On: the Guide trades inside its licence" : "Off"} />
            <SegmentedControl
              label="Side"
              value={segment}
              onChange={setSegment}
              tone={segment === "long" ? "mint" : "rose"}
              options={[
                { value: "long", label: "Long ▲" },
                { value: "short", label: "Short ▼" },
              ]}
            />
            <SegmentedControl
              label="Order type"
              value={orderType}
              onChange={setOrderType}
              options={[
                { value: "market", label: "Market" },
                { value: "limit", label: "Limit" },
                { value: "twap", label: "TWAP" },
              ]}
            />
          </div>
        </Specimen>
      </Cards>

      <Cards n={3} className="mt-7">
        <Panel variant="flat" padding="lg" className="flex h-full flex-col items-center justify-center text-center">
          <p className="caption !text-ink">Panel · flat</p>
          <p className="mt-2 text-sm text-ink-2">The frame alone, for dense grids.</p>
        </Panel>
        <Panel padding="lg" className="flex h-full flex-col items-center justify-center text-center">
          <p className="caption !text-ink">Panel · raised (default)</p>
          <p className="mt-2 text-sm text-ink-2">Tone line and a depth band.</p>
        </Panel>
        <Panel variant="sheet" padding="lg" fold className="flex h-full flex-col items-center justify-center text-center">
          <p className="caption !text-ink">Panel · sheet · fold</p>
          <p className="mt-2 text-sm text-ink-2">The one thing that matters on a view.</p>
        </Panel>
      </Cards>

      <Split className="mt-7">
        <Specimen label="Tabs · grade slider" align="stretch">
          <div className="flex flex-col gap-8">
            <Tabs
              label="Activity"
              items={[
                { id: "positions", label: "Positions", badge: 3, content: <p className="text-sm text-ink-2">Three ropes on the Floor (sample).</p> },
                { id: "orders", label: "Orders", badge: 2, content: <p className="text-sm text-ink-2">Two anchors waiting (sample).</p> },
                { id: "fills", label: "Fills", content: <p className="text-sm text-ink-2">The register of fills (sample).</p> },
              ]}
            />
            <Slider label="Leverage" value={leverage} onChange={setLeverage} min={1} max={40} ticks={[1, 3, 5, 10, 20, 40]} format={(v) => `${v}×`} dangerFrom={20} gradeOf={(v) => gradeFor({ kind: "perp", leverage: v })} />
          </div>
        </Specimen>
        <Specimen label="Fields" align="stretch">
          <div className="flex flex-col gap-6">
            <WhereToInput value={where} onChange={(event) => setWhere(event.target.value)} size="md" aside={<Button size="xs">Plan ▶</Button>} />
            <NumberField label="Size" value={amount} onChange={setAmount} unit="USDC" max="1000" decimals={6} />
            <Input label="Stop" defaultValue="3,900" mono error="The stop is above the mark. A long's anchor sits below 4,072." />
          </div>
        </Specimen>
      </Split>

      <Split className="mt-7">
        <Specimen label="Overlays · dialog · sheet · tip">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-7">
            <Button variant="ink" onClick={() => setDialog(true)}>
              Open a dialog
            </Button>
            <Button variant="ink" onClick={() => setSheet(true)}>
              Open a sheet
            </Button>
            <Tooltip content="Liquidation distance: how far the mark can fall before the rope snaps.">
              <Button variant="ghost">What is a rope?</Button>
            </Tooltip>
          </div>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Sign W4 · ascend"
            description="500 USDC + 0.3 HYPE gas from the Ridge to the Summit. Quote bound for 42 s."
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(false)}>
                  Not now
                </Button>
                <Button grade={2} onClick={() => setDialog(false)}>
                  Sign in wallet
                </Button>
              </>
            }
          >
            <p className="text-sm text-ink-2">Nothing is signed until your wallet asks you. Sample dialog.</p>
          </Dialog>
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Rule Book" description="What every route must pass before you sign.">
            <ul className="flex flex-col gap-2 font-mono text-sm text-ink">
              <li>✓ slippage ≤ 1%</li>
              <li>✓ venues on the list</li>
              <li>✓ exact approvals</li>
              <li>✓ to your own address</li>
            </ul>
          </Sheet>
        </Specimen>
        <Specimen label="Placeholder · a dithered block" align="stretch">
          <SkeletonText lines={4} />
        </Specimen>
      </Split>

      <div className="mt-7">
        <Panel padding="none">
          <PanelHeader ruled title="Log book · sample markets" aside={<Badge tone="signal" variant="solid">Sample</Badge>} />
          <DataTable columns={COLUMNS} rows={ROWS} getRowId={(row) => row.coin} caption="Sample markets" defaultSort={{ columnId: "mark", direction: "desc" }} isRowHighlighted={(row) => row.coin === "HYPE"} onRowClick={() => undefined} />
        </Panel>
      </div>
    </Section>
  );
}
