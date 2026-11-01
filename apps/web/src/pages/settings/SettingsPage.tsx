import { useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { useShortcutsStore } from "../../app/keyboard/shortcutsStore";
import { MotionSwitch } from "../../app/shell/MotionToggle";
import { modeAvailability, type NetworkMode } from "../../app/state/uiPrefs";
import { useUiStore } from "../../app/state/uiStore";
import { useResolvedTheme } from "../../app/state/useTheme";
import { EnableTradingDialog } from "../../features/agentKey/EnableTradingDialog";
import { useAgentKey } from "../../features/agentKey/useAgentKey";
import { bookSummary, effectiveRuleBook } from "../../features/trading/guard";
import { useTradeStore } from "../../features/trading/tradeStore";
import { useNow } from "../../hooks/useNow";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { Cards, Page, Section, Split } from "../../pixel/layout";
import { PixelGlyph } from "../../pixel/PixelGlyph";
import { ConditionSign } from "../../topo/ConditionSign";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { useAlertStore } from "../alerts/model/alertStore";
import { useGuideStore } from "../agent/guide/guideStore";
import { MotionArt } from "./parts/kitArt";
import { ITEM } from "./parts/kitItems";
import { RuleBookEditor } from "./parts/RuleBookEditor";
import { SheetPicker } from "./parts/SheetPicker";
import { TradingKeyCard } from "./parts/TradingKeyCard";

const SECTIONS = [
  { id: "sheet", no: "01", title: "Map sheet", line: "day, night or your device" },
  { id: "motion", no: "02", title: "Motion", line: "terrain draws in, Ely climbs" },
  { id: "network", no: "03", title: "Network", line: "practice wall or mainnet" },
  { id: "rules", no: "04", title: "Rule Book", line: "hard limits before any signature" },
  { id: "key", no: "05", title: "Trading key", line: "trade only · cannot withdraw" },
  { id: "kit", no: "06", title: "Keys and data", line: "shortcuts, this device" },
] as const;

const KEY_WORD: Readonly<Record<string, string>> = { ready: "unlocked", locked: "locked", expired: "expired", none: "not enabled", loading: "opening…", unsupported: "unavailable", error: "vault failed" };

interface Slot {
  readonly id: (typeof SECTIONS)[number]["id"];
  readonly no: string;
  readonly title: string;
  readonly item: keyof typeof ITEM;
  readonly value: string;
  readonly hot?: boolean;
}

/** The kit locker: six inventory slots, one per section, each showing the item and how it is set now. */
function Locker({ slots }: { readonly slots: readonly Slot[] }) {
  return (
    <nav aria-label="Kit locker: settings sections">
      <Cards n={6} as="ol">
        {slots.map((slot) => (
          <li key={slot.id} className="flex">
            <a href={`#${slot.id}`} className={cx("group relative flex w-full flex-col items-center gap-2 bg-card px-2 pb-3 pt-4 text-center px-frame px-drop px-press", FOCUS_RING)}>
              <span className="absolute left-2 top-1.5 font-tag text-[10px] text-ink-3">{slot.no}</span>
              {slot.hot ? <span aria-hidden="true" className="absolute right-2 top-2 inline-block h-2 w-2 bg-down" /> : null}
              <span className="flex h-[60px] w-[60px] items-center justify-center bg-paper-2 px-frame-thin">
                <PixelGlyph rows={ITEM[slot.item]} scale={4} label={null} />
              </span>
              <span className="font-display text-[17px] font-bold leading-tight text-ink">{slot.title}</span>
              <span className="font-tag text-[10px] uppercase text-ink-2">{slot.value}</span>
            </a>
          </li>
        ))}
      </Cards>
    </nav>
  );
}

/**
 * "/app/settings": the kit locker. Six inventory slots up top (each item and
 * how it is set now), then one centred section per slot: map sheet (theme),
 * motion, network mode, the Rule Book (hard limits shared by the terminal,
 * Ely and the keeper), the trading key, shortcuts and this device's data.
 * Everything is stored in this browser.
 */
export default function SettingsPage() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const openShortcuts = useShortcutsStore((state) => state.setOpen);
  const { address } = useAccount();
  const connected = address ? address.toLowerCase() : null;
  const now = useNow(30_000);
  const agent = useAgentKey(mode, connected, now);
  const endpoints = hyperCoreEndpoints(mode);
  const [enableOpen, setEnableOpen] = useState(false);
  const mainnet = modeAvailability("mainnet");
  const ruleCount = useAlertStore((state) => state.rules.length);
  const auditCount = useGuideStore((state) => state.audit.length);

  const night = useResolvedTheme() === "dark";
  const reduced = useReducedMotion();
  const overrides = useTradeStore((state) => state.overrides);
  const bookLine = useMemo(() => bookSummary(effectiveRuleBook(overrides).book), [overrides]);
  const networks: readonly { readonly value: NetworkMode; readonly name: string; readonly line: string; readonly open: boolean; readonly reason: string }[] = [
    { value: "testnet", name: "Practice wall · testnet", line: "Elysium 99801 · HyperEVM 998 · HyperCore testnet. Separate capital, fake pool prices, real mechanics.", open: true, reason: "open" },
    { value: "mainnet", name: "Mainnet", line: mainnet.reason ?? "Elysium 99901 · HyperEVM 999 · HyperCore.", open: mainnet.available, reason: mainnet.available ? "open" : "opens with Elysium mainnet" },
  ];
  const slots: readonly Slot[] = [
    { id: "sheet", no: "01", title: "Map sheet", item: theme === "dark" ? "moon" : "sun", value: theme === "light" ? "day" : theme === "dark" ? "night" : "follows device" },
    { id: "motion", no: "02", title: "Motion", item: "motion", value: reduced ? "off · end states" : "on · stepped" },
    { id: "network", no: "03", title: "Network", item: "mast", value: mode === "testnet" ? "practice wall" : "mainnet" },
    { id: "rules", no: "04", title: "Rule Book", item: "book", value: overrides.paused ? "kill switch on" : (bookLine.split(" · ")[0] ?? "defaults"), hot: overrides.paused === true },
    { id: "key", no: "05", title: "Trading key", item: "key", value: connected ? (KEY_WORD[agent.session.phase] ?? "not enabled") : "no wallet" },
    { id: "kit", no: "06", title: "Keys & data", item: "keys", value: `${ruleCount} rule${ruleCount === 1 ? "" : "s"} · ${auditCount} log` },
  ];
  const head = (index: number) => {
    const section = SECTIONS[index]!;
    return { id: section.id, tag: `${section.no} · ${section.title} · ${section.line}` };
  };

  return (
    <Page className="!pt-0">
      <Section
        level={1}
        tag="Sheet 09 · Settings · the kit locker · stored in this browser"
        title="Check your kit."
        lede={
          <>
            How the map looks, how it moves, which wall you climb, the rules every signature passes and the key that signs. <span className="font-semibold text-ink">Nothing here leaves your device.</span>
          </>
        }
      >
        <Locker slots={slots} />
        <p className="mt-8 text-center font-tag text-[11px] uppercase text-ink-3">
          Survey: Elyia · {mode === "testnet" ? "practice wall" : "mainnet"} · {new Date(now).toISOString().slice(0, 10)}
        </p>
      </Section>

      <Section {...head(0)} title="Pick your map sheet." lede="Day is paper in the sun, night is the same map under a headlamp. Every drawing redraws in the sheet's own colours.">
        <div className="mx-auto max-w-[960px]">
          <SheetPicker value={theme} onChange={setTheme} />
        </div>
      </Section>

      <Section {...head(1)} title="Motion, in steps." lede="Terrain draws in by altitude, Ely climbs, stamps thump, digits roll. Your device's reduced-motion setting always wins; nothing flashes faster than three times a second.">
        <Split>
          <div className="flex flex-col items-center justify-center gap-5 bg-card px-6 py-8 text-center px-frame px-drop">
            <p className="font-display text-[22px] font-bold text-ink">{reduced ? "Motion is off" : "Motion is on"}</p>
            <p className="max-w-[40ch] text-[15px] leading-relaxed text-ink-2">{reduced ? "Every drawing shows its end state: the map finished, Ely already on the summit." : "Loops pause off screen and in hidden tabs, on one shared clock."}</p>
            <MotionSwitch />
          </div>
          <figure className="m-0 flex flex-col bg-card px-frame px-drop">
            <div className="flex flex-1 items-center bg-paper-2 p-4">
              <MotionArt night={night} />
            </div>
            <figcaption className="border-t-2 border-rule px-4 py-2 text-center font-tag text-[11px] uppercase text-ink-2">{reduced ? "end state · motion off" : "the map draws in band by band · loops every 6 s"}</figcaption>
          </figure>
        </Split>
      </Section>

      <Section {...head(2)} title="Which wall you climb." lede="Testnet and mainnet capital never share an intent, a rule or a key.">
        <div role="radiogroup" aria-label="Network mode" className="grid grid-cols-1 gap-x-6 gap-y-7 md:grid-cols-2">
          {networks.map((network) => {
            const selected = network.value === mode;
            return (
              <button
                key={network.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-disabled={!network.open}
                onClick={() => {
                  if (!network.open) {
                    toast.info("Mainnet is not open yet", { description: network.line, from: "BASE" });
                    return;
                  }
                  setMode(network.value);
                }}
                className={cx("flex flex-col items-center gap-4 bg-card px-6 py-6 text-center px-frame", selected ? "px-drop-lg" : "px-drop opacity-90", network.open ? "px-press" : "cursor-not-allowed", FOCUS_RING)}
              >
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className={cx("inline-flex h-5 w-5 items-center justify-center font-tag text-[11px]", selected ? "bg-accent text-accent-ink" : "bg-paper-2 text-transparent")}>
                    ✓
                  </span>
                  <span className={cx("px-2.5 py-1 font-display text-[18px] font-bold px-frame-thin", network.value === "testnet" ? "bg-signal text-signal-ink" : "bg-card text-ink")}>{network.name}</span>
                </span>
                <span className="max-w-[44ch] text-[14px] leading-snug text-ink-2">{network.line}</span>
                <ConditionSign condition={network.open ? "open" : "closed"} reason={network.reason} size="sm" />
              </button>
            );
          })}
        </div>
      </Section>

      <Section {...head(3)} title="The Rule Book." lede="Hard limits checked in code before the trading key signs anything: in the terminal, for Ely and for the keeper. Loosening asks you twice; closing and cancelling always work.">
        <div className="mx-auto max-w-[960px]">
          <RuleBookEditor />
        </div>
      </Section>

      <Section {...head(4)} title="The key that signs." lede="A trade-only key born in this browser, stored encrypted, approved once by your wallet. It can place and cancel orders; it can never withdraw.">
        <div className="mx-auto max-w-[960px]">
          <TradingKeyCard api={agent} connected={connected} now={now} onEnable={() => setEnableOpen(true)} />
        </div>
      </Section>

      <Section {...head(5)} title="Keys and data." lede="Shortcuts, and what this device keeps. Clearing is local and immediate.">
        <Cards n={3} as="ul">
          <li className="flex flex-col items-center gap-3 bg-card px-5 py-6 text-center px-frame px-drop">
            <span className="font-tag text-[11px] uppercase text-ink-3">Keyboard</span>
            <span className="font-display text-[20px] font-bold text-ink">Shortcuts</span>
            <span className="text-[14px] text-ink-2">⌘K says where to, g t trades, g p opens your portfolio, A asks Ely.</span>
            <Button variant="ink" size="sm" className="mt-auto" onClick={() => openShortcuts(true)}>
              Show shortcuts
            </Button>
          </li>
          <li className="flex flex-col items-center gap-3 bg-card px-5 py-6 text-center px-frame px-drop">
            <span className="font-tag text-[11px] uppercase text-ink-3">Alerts and standing orders</span>
            <span className="tnum font-display text-[20px] font-bold text-ink">
              {ruleCount} rule{ruleCount === 1 ? "" : "s"}
            </span>
            <span className="text-[14px] text-ink-2">Kept on this device, watched while Elyia is open.</span>
            <Button
              variant="danger"
              size="sm"
              className="mt-auto"
              disabled={ruleCount === 0}
              onClick={() => {
                for (const rule of useAlertStore.getState().rules) useAlertStore.getState().removeRule(rule.id);
                useAlertStore.getState().clearFeed();
                toast.success("Alerts cleared", { from: "BASE" });
              }}
            >
              Clear all
            </Button>
          </li>
          <li className="flex flex-col items-center gap-3 bg-card px-5 py-6 text-center px-frame px-drop">
            <span className="font-tag text-[11px] uppercase text-ink-3">Guide audit log</span>
            <span className="tnum font-display text-[20px] font-bold text-ink">
              {auditCount} entr{auditCount === 1 ? "y" : "ies"}
            </span>
            <span className="text-[14px] text-ink-2">Every proposal, signature and refusal Ely logged here.</span>
            <Button
              variant="danger"
              size="sm"
              className="mt-auto"
              disabled={auditCount === 0}
              onClick={() => {
                useGuideStore.getState().clearAudit();
                toast.success("Audit log cleared", { from: "BASE" });
              }}
            >
              Clear the log
            </Button>
          </li>
        </Cards>
      </Section>
      <EnableTradingDialog open={enableOpen} onClose={() => setEnableOpen(false)} api={agent} hyperliquidChain={endpoints.hyperliquidChain} />
    </Page>
  );
}
