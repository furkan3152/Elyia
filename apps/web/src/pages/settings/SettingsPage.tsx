import { useState } from "react";
import { useAccount } from "wagmi";

import { useShortcutsStore } from "../../app/keyboard/shortcutsStore";
import { MotionSwitch } from "../../app/shell/MotionToggle";
import { Page } from "../../app/shell/Page";
import { modeAvailability, type NetworkMode } from "../../app/state/uiPrefs";
import { useUiStore } from "../../app/state/uiStore";
import { EnableTradingDialog } from "../../features/agentKey/EnableTradingDialog";
import { useAgentKey } from "../../features/agentKey/useAgentKey";
import { useNow } from "../../hooks/useNow";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { ConditionSign } from "../../topo/ConditionSign";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { useAlertStore } from "../alerts/model/alertStore";
import { useGuideStore } from "../agent/guide/guideStore";
import { RuleBookEditor } from "./parts/RuleBookEditor";
import { SheetPicker } from "./parts/SheetPicker";
import { TradingKeyCard } from "./parts/TradingKeyCard";

const SECTIONS = [
  { id: "sheet", no: "01", title: "Map sheet", line: "day, night or your device" },
  { id: "motion", no: "02", title: "Motion", line: "contours draw, stamps thump" },
  { id: "network", no: "03", title: "Network", line: "practice wall or mainnet" },
  { id: "rules", no: "04", title: "Rule Book", line: "hard limits before any signature" },
  { id: "key", no: "05", title: "Trading key", line: "trade only · cannot withdraw" },
  { id: "kit", no: "06", title: "Keys and data", line: "shortcuts, this device" },
] as const;

function Section({ id, no, title, line, children }: { readonly id: string; readonly no: string; readonly title: string; readonly line: string; readonly children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 border-t-2 border-rule pt-5">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-[13px] font-semibold text-ink-3">{no}</span>
        <h2 id={`${id}-title`} className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
          {title}
        </h2>
        <span className="caption">{line}</span>
      </div>
      {children}
    </section>
  );
}

/** A drawn contour that draws on: what Motion switches. */
function MotionSample() {
  const reduced = useReducedMotion();
  const [key, setKey] = useState(0);
  return (
    <button type="button" onClick={() => setKey((value) => value + 1)} className={cx("group flex items-center gap-4 border-2 border-rule bg-card px-4 py-3 text-left shadow-hard", FOCUS_RING)} aria-label="Replay the motion sample">
      <svg key={key} viewBox="0 0 160 60" className="h-14 w-40 shrink-0" aria-hidden="true">
        {[
          "M8 54 C 20 30, 52 8, 84 10 S 150 30, 152 50",
          "M26 54 C 34 36, 58 20, 84 20 S 136 36, 136 52",
          "M44 50 C 50 38, 66 30, 84 30 S 118 40, 116 50 S 60 58, 44 50 Z",
          "M64 44 C 68 38, 78 36, 86 37 S 100 42, 98 46 S 72 50, 64 44 Z",
        ].map((d, index) => (
          <path key={d} d={d} pathLength={1} className="el-draw" style={{ animationDelay: `${index * 160}ms` }} fill="none" stroke="rgb(var(--contour))" strokeOpacity={0.55 + index * 0.15} strokeWidth={index === 3 ? 1.8 : 1.3} />
        ))}
        <path d="M82 37 l4 -7 l4 7 z" fill="rgb(var(--ink))" />
      </svg>
      <span className="font-mono text-[12px] text-ink-2">{reduced ? "Motion is off: every drawing shows its end state." : "Contours draw on, stamps thump, digits roll. Tap to replay."}</span>
    </button>
  );
}

/**
 * "/app/settings": the kit check. Map sheet (theme), motion, network mode,
 * the Rule Book (hard limits shared by the terminal, the Guide and the
 * keeper), the trading key, shortcuts and this device's data. Everything is
 * stored in this browser.
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

  const networks: readonly { readonly value: NetworkMode; readonly name: string; readonly line: string; readonly open: boolean; readonly reason: string }[] = [
    { value: "testnet", name: "Practice wall · testnet", line: "Elysium 99801 · HyperEVM 998 · HyperCore testnet. Separate capital, fake pool prices, real mechanics.", open: true, reason: "open" },
    { value: "mainnet", name: "Mainnet", line: mainnet.reason ?? "Elysium 99901 · HyperEVM 999 · HyperCore.", open: mainnet.available, reason: mainnet.available ? "open" : "opens with Elysium mainnet" },
  ];

  return (
    <Page className="pb-16">
      <header className="mb-8 max-w-3xl sm:mb-10">
        <p className="label-tab mb-4">Sheet 09 · Settings · kit check · stored in this browser</p>
        <h1 className="text-[44px] font-bold leading-[1] tracking-[-0.03em] text-ink sm:text-[64px]">Check your kit.</h1>
        <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-2 text-pretty sm:text-[19px]">
          How the map looks, how it moves, which wall you climb, the rules every signature passes and the key that signs. <span className="font-semibold text-ink">Nothing here leaves your device.</span>
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] xl:gap-12">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-28 lg:self-start">
          <ol className="grid grid-cols-2 gap-x-4 border-2 border-rule bg-card p-3 shadow-hard sm:grid-cols-3 lg:grid-cols-1 lg:gap-0 lg:p-0">
            {SECTIONS.map((section) => (
              <li key={section.id} className="lg:border-b-1.5 lg:border-rule/20 lg:last:border-b-0">
                <a href={`#${section.id}`} className={cx("flex items-baseline gap-2.5 py-1.5 hover:text-ink lg:px-4 lg:py-2.5", FOCUS_RING)}>
                  <span className="font-mono text-[11px] text-ink-3">{section.no}</span>
                  <span className="text-[14px] font-semibold text-ink-2">{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
          <p className="mt-3 hidden font-mono text-[11px] leading-relaxed text-ink-3 lg:block">Survey: Elyia · {mode === "testnet" ? "practice wall" : "mainnet"} · {new Date(now).toISOString().slice(0, 10)}</p>
        </nav>

        <div className="flex min-w-0 flex-col gap-12">
          <Section {...SECTIONS[0]}>
            <SheetPicker value={theme} onChange={setTheme} />
          </Section>

          <Section {...SECTIONS[1]}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-md">
                <p className="text-[15px] leading-relaxed text-ink-2">Draw-on contours, the rope climber, rolling digits. Your device&apos;s reduced-motion setting always wins; nothing ever flashes faster than three times a second.</p>
                <MotionSwitch className="mt-3" />
              </div>
              <MotionSample />
            </div>
          </Section>

          <Section {...SECTIONS[2]}>
            <div role="radiogroup" aria-label="Network mode" className="grid gap-4 sm:grid-cols-2">
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
                    className={cx("flex flex-col gap-3 border-2 p-4 text-left transition-[transform,box-shadow] duration-fast", selected ? "border-rule bg-card shadow-hard-lg" : "border-rule/40 bg-paper hover:border-rule", !network.open && "cursor-not-allowed", FOCUS_RING)}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className={cx("px-2 py-1 font-sans text-[14px] font-bold uppercase tracking-[0.04em]", network.value === "testnet" ? "border-2 border-rule bg-signal text-signal-ink" : "border-2 border-rule bg-card text-ink")}>{network.name}</span>
                      <span aria-hidden="true" className={cx("flex h-5 w-5 items-center justify-center border-2 border-rule text-[11px] font-bold", selected ? "bg-ink text-paper" : "text-transparent")}>
                        ✓
                      </span>
                    </span>
                    <span className="text-[14px] leading-snug text-ink-2">{network.line}</span>
                    <ConditionSign condition={network.open ? "open" : "closed"} reason={network.reason} size="sm" />
                  </button>
                );
              })}
            </div>
            <p className="mt-3 font-mono text-[11px] text-ink-3">Testnet and mainnet capital never share an intent, a rule or a key.</p>
          </Section>

          <Section {...SECTIONS[3]}>
            <RuleBookEditor />
          </Section>

          <Section {...SECTIONS[4]}>
            <TradingKeyCard api={agent} connected={connected} now={now} onEnable={() => setEnableOpen(true)} />
          </Section>

          <Section {...SECTIONS[5]}>
            <ul className="grid gap-3 sm:grid-cols-3">
              <li className="flex flex-col gap-2 border-2 border-rule bg-card p-4 shadow-hard">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">Keyboard</span>
                <span className="text-[14px] text-ink-2">⌘K says where to, g t trades, g p opens your portfolio, A asks the Guide.</span>
                <Button variant="ink" size="sm" className="mt-auto self-start" onClick={() => openShortcuts(true)}>
                  Show shortcuts
                </Button>
              </li>
              <li className="flex flex-col gap-2 border-2 border-rule bg-card p-4 shadow-hard">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">Alerts and standing orders</span>
                <span className="tnum text-[14px] text-ink-2">{ruleCount} rule{ruleCount === 1 ? "" : "s"} on this device.</span>
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-auto self-start"
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
              <li className="flex flex-col gap-2 border-2 border-rule bg-card p-4 shadow-hard">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">Guide audit log</span>
                <span className="tnum text-[14px] text-ink-2">{auditCount} entr{auditCount === 1 ? "y" : "ies"} on this device.</span>
                <Button
                  variant="danger"
                  size="sm"
                  className="mt-auto self-start"
                  disabled={auditCount === 0}
                  onClick={() => {
                    useGuideStore.getState().clearAudit();
                    toast.success("Audit log cleared", { from: "BASE" });
                  }}
                >
                  Clear the log
                </Button>
              </li>
            </ul>
          </Section>
        </div>
      </div>
      <EnableTradingDialog open={enableOpen} onClose={() => setEnableOpen(false)} api={agent} hyperliquidChain={endpoints.hyperliquidChain} />
    </Page>
  );
}
