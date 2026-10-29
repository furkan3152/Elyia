import { Copy, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge, Chip } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import type { ButtonVariant } from "../../ui/buttonStyles";
import { IconButton } from "../../ui/IconButton";
import { Input } from "../../ui/Input";
import { KbdCombo } from "../../ui/Kbd";
import { NumberInput } from "../../ui/NumberInput";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Slider } from "../../ui/Slider";
import { Tabs } from "../../ui/Tabs";
import { Toggle } from "../../ui/Toggle";
import { Tooltip } from "../../ui/Tooltip";
import { KitSection } from "./KitSection";

const VARIANTS: readonly ButtonVariant[] = ["primary", "soft", "gold", "ghost", "outline", "danger", "long", "short"];

/** Buttons, badges and form controls. */
export function ControlsSection() {
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [side, setSide] = useState<"long" | "short">("long");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tab, setTab] = useState("positions");
  return (
    <>
      <KitSection
        id="buttons"
        title="Button · IconButton · ButtonLink"
        description="primary (alias violet) for the brand action, gold for plan / sign / approve, long and short for trade sides, danger for flatten and cancel. Sizes xs–xl (md 40 px, lg 48 px touch). Navigation uses ButtonLink so middle-click works."
        code={'import { Button, ButtonLink, IconButton } from "../../ui";\n<Button variant="gold" loading={signing}>Sign step 1</Button>\n<ButtonLink to={routeHref("trade", { market: "ETH" })} variant="soft">Trade ETH</ButtonLink>\n<IconButton label="Copy address" icon={<Copy />} />'}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Button key={size} size={size} variant="outline">
                size {size}
              </Button>
            ))}
            <Button loading variant="gold">
              Signing
            </Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Add" icon={<Plus className="h-4 w-4" />} variant="outline" />
            <IconButton label="Copy" icon={<Copy className="h-4 w-4" />} />
            <IconButton label="Delete" icon={<Trash2 className="h-4 w-4" />} variant="danger" />
            <Button variant="long" size="lg">
              Long ETH
            </Button>
            <Button variant="short" size="lg">
              Short ETH
            </Button>
          </div>
        </div>
      </KitSection>

      <KitSection
        id="badges"
        title="Badge · Chip · Kbd · Tooltip"
        description="Badge is a static label (status, network, demo); Chip is a button (examples, filters; selected = toggle). Kbd shows keys; mod renders ⌘ or Ctrl. Tooltip is supplementary only."
        code={'<Badge tone="mint" dot="pulse">live</Badge>  <Chip tone="gold" onClick={…}>long ETH 5x</Chip>\n<KbdCombo keys={["mod", "K"]} />  <Tooltip content="Liquidation at $2,914"><button>…</button></Tooltip>'}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="mint" dot="pulse">
              live
            </Badge>
            <Badge tone="gold">demo</Badge>
            <Badge tone="violet" variant="outline">
              HyperCore
            </Badge>
            <Badge tone="rose" variant="solid">
              liquidation 6%
            </Badge>
            <Badge tone="sky">info</Badge>
            <Badge>neutral</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="gold" mono>
              <Sparkles className="h-3.5 w-3.5" />
              long ETH 5x with 200 USDC
            </Chip>
            <Chip selected>selected</Chip>
            <Chip>filter</Chip>
            <KbdCombo keys={["mod", "K"]} />
            <KbdCombo keys={["G", "T"]} joiner="then" />
            <Tooltip content="Liquidation at $2,914.20 (14% away)">
              <Button variant="outline" size="sm">
                Hover me
              </Button>
            </Tooltip>
          </div>
        </div>
      </KitSection>

      <KitSection
        id="inputs"
        title="Input · NumberInput · Slider · Toggle · SegmentedControl · Tabs"
        description="Amounts are decimal strings end to end (no floats): NumberInput sanitises typing and pasting, caps decimals, computes presets exactly with BigInt and reports an amount above max in plain words. Slider is a native range (keyboard, touch, screen readers) with ticks."
        code={'<NumberInput value={amount} onChange={setAmount} max="1.5" decimals={6} unit="USDC" />\n<Slider value={lev} onChange={setLev} min={1} max={40} ticks={[1, 2, 5, 10, 20, 40]} format={(v) => `${v}x`} dangerFrom={20} />\n<SegmentedControl label="Side" value={side} onChange={setSide} tone={side === "long" ? "mint" : "rose"} options={[…]} />'}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Input label="Address or ENS" placeholder="0x…" mono hint="Paste any address on Elysium, HyperEVM or HyperCore." />
            <Input label="With an error" defaultValue="0x12" mono error="That is not a full address: it needs 40 hex characters after 0x." />
            <NumberInput label="Margin" value={amount} onChange={setAmount} max="1250.5" decimals={6} unit="USDC" />
          </div>
          <div className="flex flex-col gap-5">
            <SegmentedControl
              label="Side"
              value={side}
              onChange={setSide}
              tone={side === "long" ? "mint" : "rose"}
              fullWidth
              options={[
                { value: "long", label: "Long" },
                { value: "short", label: "Short" },
              ]}
            />
            <Slider label="Leverage" value={leverage} onChange={setLeverage} min={1} max={40} ticks={[1, 2, 5, 10, 20, 40]} format={(v) => `${v}x`} dangerFrom={20} />
            <Toggle checked={reduceOnly} onChange={setReduceOnly} label="Reduce only" description="Never increases the position." />
            <Tabs
              label="Account"
              value={tab}
              onChange={setTab}
              items={[
                { id: "positions", label: "Positions", badge: 4, content: <p className="text-sm text-text-1">Positions panel</p> },
                { id: "orders", label: "Orders", badge: 2, content: <p className="text-sm text-text-1">Open orders panel</p> },
                { id: "fills", label: "Fills", content: <p className="text-sm text-text-1">Fills panel</p> },
                { id: "funding", label: "Funding", content: <p className="text-sm text-text-1">Funding panel</p> },
              ]}
            />
          </div>
        </div>
      </KitSection>
    </>
  );
}
