import { KeyRound, Send } from "lucide-react";

import { MotionSwitch } from "../../app/shell/MotionToggle";
import { Page, PageHeader } from "../../app/shell/Page";
import { useShortcutsStore } from "../../app/keyboard/shortcutsStore";
import { modeAvailability, type NetworkMode, type ThemePreference } from "../../app/state/uiPrefs";
import { useUiStore } from "../../app/state/uiStore";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Panel, PanelHeader } from "../../ui/Panel";
import { SegmentedControl } from "../../ui/SegmentedControl";

function Row({ title, description, control }: { readonly title: string; readonly description: string; readonly control: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-0">{title}</p>
        <p className="text-xs text-text-2">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/**
 * Settings v1: appearance, motion and network mode work now (the ui store);
 * the Telegram link and the trading key arrive with their builds.
 */
export default function SettingsPage() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  const openShortcuts = useShortcutsStore((state) => state.setOpen);
  const mainnet = modeAvailability("mainnet");
  return (
    <Page width="narrow">
      <PageHeader eyebrow="Settings" title="Your deck, your way" description="Stored in this browser only. Nothing here leaves your device." />
      <div className="flex flex-col gap-4">
        <Panel>
          <PanelHeader title="Appearance and motion" />
          <Row
            title="Theme"
            description="Night of the fields, Dawn, or follow your device."
            control={
              <SegmentedControl<ThemePreference>
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "system", label: "System" },
                  { value: "dark", label: "Night" },
                  { value: "light", label: "Dawn" },
                ]}
              />
            }
          />
          <Row title="Motion" description="Rays, strings and the aurora. Your device's reduced-motion setting always wins." control={<MotionSwitch />} />
          <Row title="Keyboard" description="⌘K speaks, g t trades, g p opens your portfolio." control={<Button variant="outline" size="sm" onClick={() => openShortcuts(true)}>Show shortcuts</Button>} />
        </Panel>
        <Panel>
          <PanelHeader title="Network" aside={<Badge tone={mode === "testnet" ? "mint" : "gold"} dot>{mode}</Badge>} />
          <Row
            title="Mode"
            description={mainnet.available ? "Testnet and mainnet capital never share an intent." : (mainnet.reason ?? "Mainnet is not available yet.")}
            control={
              <SegmentedControl<NetworkMode>
                label="Network mode"
                value={mode}
                onChange={(next) => setMode(next)}
                options={[
                  { value: "testnet", label: "Testnet" },
                  { value: "mainnet", label: "Mainnet", disabled: !mainnet.available, hint: mainnet.reason ?? undefined },
                ]}
              />
            }
          />
        </Panel>
        <Panel>
          <PanelHeader title="Arriving next" aside={<Badge tone="gold">under construction</Badge>} />
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="flex items-start gap-3 rounded-xl border border-line p-3">
              <Send className="mt-0.5 h-4 w-4 text-violet-soft" aria-hidden="true" />
              <span>
                <span className="block text-sm text-text-0">Telegram link</span>
                <span className="block text-xs text-text-2">Alerts and agent proposals in Telegram, linked with a one-time code.</span>
              </span>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-line p-3">
              <KeyRound className="mt-0.5 h-4 w-4 text-violet-soft" aria-hidden="true" />
              <span>
                <span className="block text-sm text-text-0">Trading key</span>
                <span className="block text-xs text-text-2">A trade-only HyperCore key in this browser: it can trade, never withdraw.</span>
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </Page>
  );
}
