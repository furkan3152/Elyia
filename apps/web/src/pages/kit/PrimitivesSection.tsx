import { Copy, Plus } from "lucide-react";
import { useState } from "react";

import { Badge, Chip, GradeChip, LayerChip, Tag } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable, type DataColumn } from "../../ui/DataTable";
import { Dialog } from "../../ui/Dialog";
import { EmptyState } from "../../ui/EmptyState";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { KbdCombo } from "../../ui/Kbd";
import { NumberField } from "../../ui/NumberInput";
import { Panel, PanelHeader, SectionHeader } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Sheet } from "../../ui/Sheet";
import { Skeleton, SkeletonText } from "../../ui/Skeleton";
import { Slider } from "../../ui/Slider";
import { Tabs } from "../../ui/Tabs";
import { toast } from "../../ui/toast";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { WhereToInput } from "../../ui/WhereToInput";
import { gradeFor } from "../../topo/geometry/conditions";
import { KeySection, Specimen } from "./KeySection";

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
  { id: "coin", header: "Market", cell: (row) => <span className="font-bold">{row.coin}</span>, sortValue: (row) => row.coin, firstSort: "asc" },
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

export function PrimitivesSection() {
  const [loading, setLoading] = useState(false);
  const [segment, setSegment] = useState<"long" | "short">("long");
  const [size, setSize] = useState<"market" | "limit" | "twap">("market");
  const [amount, setAmount] = useState("250");
  const [leverage, setLeverage] = useState(5);
  const [toggle, setToggle] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [where, setWhere] = useState("ascend 1,000 USDC: half to kHYPE, half to the Kalos pool");

  return (
    <>
      <KeySection id="buttons" number="05" title="Actions" description="One primary action per view: filled glacier, ink border, hard shadow. Pressing pushes the card into its shadow. Loading draws contours, never a spinner." importLine='import { Button, ButtonLink, IconButton, Kbd } from "src/ui"'>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Specimen label="Variants">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" rightIcon={<span aria-hidden="true">→</span>}>
                Open the deck
              </Button>
              <Button variant="ink">Try a route</Button>
              <Button variant="solid-ink">Set anchor</Button>
              <Button variant="signpost">Elysium · bridge</Button>
              <Button variant="danger">Kill switch</Button>
              <Button variant="ghost">Cancel</Button>
            </div>
          </Specimen>
          <Specimen label="Trade sides · grades on every action">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="long" grade={gradeFor({ kind: "perp", leverage: 3 })}>
                Long ▲
              </Button>
              <Button variant="short" grade={gradeFor({ kind: "perp", leverage: 20 })}>
                Short ▼
              </Button>
              <Button variant="primary" grade={1}>
                Stake
              </Button>
            </div>
          </Specimen>
          <Specimen label="Sizes · loading · disabled">
            <div className="flex flex-wrap items-center gap-3">
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
              <Button
                variant="primary"
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  window.setTimeout(() => setLoading(false), 2400);
                }}
              >
                {loading ? "Reading the chain" : "Sign W4 · ascend"}
              </Button>
              <Button variant="primary" disabled>
                Quote expired
              </Button>
            </div>
          </Specimen>
          <Specimen label="Icon buttons · keys">
            <div className="flex flex-wrap items-center gap-3">
              <IconButton label="Copy address" icon={<Copy className="h-4 w-4" aria-hidden="true" />} variant="ink" />
              <IconButton label="Add" icon={<Plus className="h-4 w-4" aria-hidden="true" />} variant="primary" />
              <KbdCombo keys={["mod", "K"]} />
              <KbdCombo keys={["g", "t"]} joiner="then" />
              <KbdCombo keys={["B"]} />
              <KbdCombo keys={["S"]} />
            </div>
          </Specimen>
        </div>
      </KeySection>

      <KeySection id="labels" number="06" title="Labels and chips" description="Label tabs above headlines, layer chips coloured by altitude, grade chips with the blaze. Square, bordered, mono caps." importLine='import { Tag, LayerChip, GradeChip, Badge, Chip } from "src/ui"'>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Specimen label="Label tab">
            <div className="flex flex-col items-start gap-3">
              <Tag>Portfolio relief · HyperCore + HyperEVM + Elysium</Tag>
              <Tag>Route card 7F3A · grade T2</Tag>
            </div>
          </Specimen>
          <Specimen label="Layers">
            <div className="flex flex-wrap items-center gap-4">
              <LayerChip layer="floor" network />
              <LayerChip layer="ridge" network />
              <LayerChip layer="summit" network />
              <LayerChip layer="floor" variant="solid" />
              <LayerChip layer="ridge" variant="solid" />
              <LayerChip layer="summit" variant="solid" />
            </div>
          </Specimen>
          <Specimen label="Grades · badges">
            <div className="flex flex-wrap items-center gap-2.5">
              <GradeChip grade={1} />
              <GradeChip grade={3} />
              <GradeChip grade={6} />
              <Badge tone="signal" variant="solid">
                Practice wall
              </Badge>
              <Badge tone="up" dot>
                Live
              </Badge>
              <Badge tone="down">Fraying</Badge>
              <Badge tone="warn">Caution</Badge>
              <Badge>Sample</Badge>
            </div>
          </Specimen>
          <Specimen label="Chips (example sentences, filters)">
            <div className="flex flex-wrap items-center gap-2">
              <Chip mono>“long ETH 5x with 200 USDC”</Chip>
              <Chip selected>Perps</Chip>
              <Chip>Spot</Chip>
              <Chip tone="summit">Summit only</Chip>
            </div>
          </Specimen>
        </div>
      </KeySection>

      <KeySection id="panels" number="07" title="Sheets and panels" description="Cards are card stock: 2 px ink border, hard offset shadow, square corners; a folded corner where a sheet continues. Section headers are mono micro-caps with “ · ”." importLine='import { Panel, PanelHeader, SectionHeader } from "src/ui"'>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <Panel>
            <PanelHeader title="Rope · 3 positions" aside="sample" />
            <p className="text-xl font-bold text-ink">19% to the crevasse</p>
            <p className="mt-1 text-sm text-ink-2">Each position is a rope from liquidation to your flag.</p>
          </Panel>
          <Panel variant="sheet" fold>
            <PanelHeader title="Avalanche bulletin" />
            <p className="text-xl font-bold text-ink">Level 3 · considerable</p>
            <p className="mt-1 text-sm text-ink-2">Shock HYPE −20% and see which ropes snap.</p>
          </Panel>
          <Panel variant="well">
            <SectionHeader parts={["Guide", "keeper mode"]} title="Trades, never withdraws" description="Optional keeper licence with punched days and a kill switch." level={3} className="mb-0" />
          </Panel>
        </div>
      </KeySection>

      <KeySection id="controls" number="08" title="Controls" description="Tabs underline in glacier; segmented choices are ink blocks; the grade slider carries blazes; toggles are ink switches with a yellow nub." importLine='import { Tabs, SegmentedControl, Slider, Toggle } from "src/ui"'>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Specimen label="Tabs">
            <Tabs
              label="Activity"
              items={[
                { id: "positions", label: "Positions", badge: 3, content: <p className="text-sm text-ink-2">Three ropes on the Floor (sample).</p> },
                { id: "orders", label: "Orders", badge: 2, content: <p className="text-sm text-ink-2">Two anchors waiting (sample).</p> },
                { id: "fills", label: "Fills", content: <p className="text-sm text-ink-2">The register of fills (sample).</p> },
              ]}
            />
          </Specimen>
          <Specimen label="Segmented">
            <div className="flex flex-col items-start gap-3">
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
                value={size}
                onChange={setSize}
                options={[
                  { value: "market", label: "Market" },
                  { value: "limit", label: "Limit" },
                  { value: "twap", label: "TWAP" },
                ]}
              />
            </div>
          </Specimen>
          <Specimen label="Grade slider">
            <Slider label="Leverage" value={leverage} onChange={setLeverage} min={1} max={40} ticks={[1, 3, 5, 10, 20, 40]} format={(v) => `${v}×`} dangerFrom={20} gradeOf={(v) => gradeFor({ kind: "perp", leverage: v })} />
          </Specimen>
          <Specimen label="Toggle">
            <div className="flex flex-col gap-3">
              <Toggle checked={toggle} onChange={setToggle} label="Reduce-only" description="Never adds to the rope, only shortens it." />
              <Toggle checked={false} onChange={() => undefined} label="Keeper mode" description="Off until you issue a licence." disabled />
            </div>
          </Specimen>
        </div>
      </KeySection>

      <KeySection id="inputs" number="09" title="Fields" description="The WHERE TO? signpost takes a whole sentence. Amounts are decimal-safe with the unit printed on the field; errors say the fix." importLine='import { WhereToInput, Input, NumberField } from "src/ui"'>
        <div className="grid grid-cols-1 gap-8">
          <WhereToInput value={where} onChange={(event) => setWhere(event.target.value)} aside={<Button size="sm">Plan ▸</Button>} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <NumberField label="Size" value={amount} onChange={setAmount} unit="USDC" max="1000" decimals={6} />
            <Input label="Watch a range" placeholder="address, vault or .hl name" mono hint="Read-only. Nothing is signed." />
            <Input label="Stop" defaultValue="3,900" mono error="The stop is above the mark. A long's anchor sits below 4,072." />
          </div>
        </div>
      </KeySection>

      <KeySection id="overlays" number="10" title="Dialogs, sheets, radio, tips" description="A dialog is a card laid on the map; phones get a bottom sheet. Toasts arrive as radio messages from base camp." importLine='import { Dialog, Sheet, toast, Tooltip } from "src/ui"'>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ink" onClick={() => setDialog(true)}>
            Open dialog
          </Button>
          <Button variant="ink" onClick={() => setSheet(true)}>
            Open sheet
          </Button>
          <Button variant="ink" onClick={() => toast.success("W2 settled on the Ridge", { from: "RIDGE", description: "11.94 HYPE · tx 0x5e1c…9a04" })}>
            Radio: settled
          </Button>
          <Button variant="ink" onClick={() => toast.error("Quote expired", { from: "GUIDE", description: "Prices moved past the bound. Re-quote to sign W4.", action: { label: "Re-quote", onClick: () => undefined } })}>
            Radio: alert
          </Button>
          <Tooltip content="Liquidation distance: how far the mark can fall before the rope snaps.">
            <Button variant="ghost">Hover me</Button>
          </Tooltip>
        </div>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Sign W4 · ascend to the Summit"
          description="500 USDC + 0.3 HYPE gas over the canonical bridge. About 3 minutes up."
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(false)}>
                Not now
              </Button>
              <Button variant="primary" grade={2} onClick={() => setDialog(false)}>
                Sign in wallet
              </Button>
            </>
          }
        >
          <p className="text-[15px] text-ink-2">Your wallet shows the exact payload. Elyia never signs for you and never holds your key.</p>
        </Dialog>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Rule Book" description="What every route must pass before you sign.">
          <ul className="font-mono text-[13px] leading-loose text-ink">
            <li>✓ slippage ≤ 1%</li>
            <li>✓ venues on the list</li>
            <li>✓ exact approvals</li>
            <li>✓ to your own address</li>
            <li>✓ day cap $5,000</li>
          </ul>
        </Sheet>
      </KeySection>

      <KeySection id="table" number="11" title="Log book, placeholders, empty" description="Tables are ruled log books with a red margin rule. While data travels, faint contours stand where it will be. Empty states draw a small scene and offer one step." importLine='import { DataTable, Skeleton, EmptyState } from "src/ui"'>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel padding="none">
            <PanelHeader title="Markets · sample" ruled />
            <DataTable columns={COLUMNS} rows={ROWS} getRowId={(row) => row.coin} caption="Sample markets" defaultSort={{ columnId: "mark", direction: "desc" }} isRowHighlighted={(row) => row.coin === "HYPE"} onRowClick={() => undefined} />
          </Panel>
          <div className="grid grid-cols-1 gap-6">
            <Panel>
              <PanelHeader title="Loading" />
              <div className="flex flex-col gap-3">
                <Skeleton className="h-8 w-2/3" />
                <SkeletonText lines={3} />
              </div>
            </Panel>
            <Panel>
              <EmptyState compact title="No ropes yet" description="Open a position and it appears here as a rope from liquidation to your flag." example="long ETH 5x with 200 USDC" />
            </Panel>
          </div>
        </div>
      </KeySection>
    </>
  );
}
