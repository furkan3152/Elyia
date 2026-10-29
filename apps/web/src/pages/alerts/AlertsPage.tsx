import { useEffect, useMemo } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../app/routes/routeTable";
import { Link } from "../../app/routes/Link";
import { Page } from "../../app/shell/Page";
import { useUiStore } from "../../app/state/uiStore";
import { useAccountFeeds } from "../../features/trading/useAccountFeeds";
import { useMarketCatalog } from "../../features/trading/useMarketData";
import { usePositionRopes } from "../../features/trading/useTopoData";
import { useNow } from "../../hooks/useNow";
import { RadioLog, type RadioEntry } from "../../topo/RadioLog";
import { SignpostCluster } from "../../topo/Signpost";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { useAlertStore } from "./model/alertStore";
import { newRuleId, ruleCondition, type AlertRule } from "./model/rules";
import { useRuleWatch } from "./model/useRuleWatch";
import { RuleBuilder } from "./parts/RuleBuilder";
import { RulesLog } from "./parts/RulesLog";
import { TelegramCard } from "./parts/TelegramCard";

const FALLBACK_COINS = ["BTC", "ETH", "HYPE", "SOL"];

function roundLevel(value: number): number {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(value))) - 2);
  return Math.round(value / magnitude) * magnitude;
}

function money(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: value >= 100 ? 0 : value >= 1 ? 2 : 5 });
}

/**
 * "/app/alerts": the radio. Rules in plain sentences (price, funding, rope
 * distance, fills, bridge settled) with their live reading drawn as a short
 * trail, one-tap lines from the market now, the in-app feed of what fired
 * and the Telegram link. Rules are watched while Elyia is open in this
 * browser; nothing here signs.
 */
export default function AlertsPage() {
  const mode = useUiStore((state) => state.mode);
  const { address } = useAccount();
  const connected = address ? address.toLowerCase() : null;
  const feeds = useAccountFeeds(mode, connected, null, "");
  const ropes = usePositionRopes(mode, feeds);
  const now = useNow(5_000);
  const watch = useRuleWatch({ mode, ropes, fills: feeds.fills, now, live: connected !== null });
  const catalog = useMarketCatalog(mode);
  const rules = useAlertStore((state) => state.rules);
  const feed = useAlertStore((state) => state.feed);

  const coins = useMemo(() => {
    const perps = catalog.markets.filter((market) => market.kind === "perp" && market.ctx?.markPx).sort((a, b) => (b.ctx?.dayNtlVlm ?? 0) - (a.ctx?.dayNtlVlm ?? 0));
    const top = perps.slice(0, 40).map((market) => market.coin);
    return top.length > 0 ? top : FALLBACK_COINS;
  }, [catalog.markets]);
  const ropeCoins = useMemo(() => ropes.map((rope) => rope.coin), [ropes]);

  // Opening the radio reads the feed.
  useEffect(() => {
    if (feed.some((item) => !item.read)) useAlertStore.getState().markRead();
  }, [feed]);

  const add = (rule: AlertRule) => {
    useAlertStore.getState().addRule(rule);
    toast.success("Alert armed", { description: ruleCondition(rule), from: "BASE", id: `armed-${rule.id}` });
  };

  const quick = useMemo(() => {
    const at = now;
    const btc = watch.readings.mids.BTC;
    const eth = watch.readings.funding.ETH;
    const blades: { destination: string; eta: string; detail: string; rule: AlertRule }[] = [];
    const base = { channels: { app: true, telegram: false }, armed: true, once: false, createdAt: at, lastFiredAt: null } as const;
    if (btc) {
      const level = roundLevel(btc * 0.95);
      blades.push({ destination: `BTC below $${money(level)}`, eta: "−5%", detail: `now $${money(btc)}`, rule: { ...base, id: "", kind: "price", coin: "BTC", direction: "below", threshold: level } });
    }
    if (eth !== undefined) blades.push({ destination: "ETH funding above 50% APR", eta: "wind", detail: `now ${(eth * 24 * 365 * 100).toFixed(1)}% APR`, rule: { ...base, id: "", kind: "funding", coin: "ETH", direction: "above", threshold: 0.5 } });
    blades.push({ destination: "Any rope under 10%", eta: "rope", detail: ropes.length > 0 ? `${ropes.length} rope${ropes.length === 1 ? "" : "s"} out` : "fires once you hold one", rule: { ...base, id: "", kind: "rope", coin: null, direction: "below", threshold: 0.1 } });
    blades.push({ destination: "Every fill", eta: "fills", detail: connected ? "your orders on HyperCore" : "connect to hear fills", rule: { ...base, id: "", kind: "fill", coin: null, direction: "above", threshold: null } });
    return blades;
  }, [watch.readings.mids.BTC, watch.readings.funding.ETH, ropes.length, connected, now]);

  const radio: RadioEntry[] =
    feed.length > 0
      ? feed.slice(0, 40).map((item) => ({
          id: item.id,
          at: item.at,
          from: item.action ? "GUIDE" : "ALERT",
          to: "you",
          tone: item.kind === "rope" ? ("alert" as const) : item.kind === "fill" ? ("settled" as const) : ("plain" as const),
          message: item.action ? (
            <>
              {item.message} · drafted “{item.action}” ·{" "}
              <Link to={routeHref("agent")} className={cx("underline decoration-dotted underline-offset-2", FOCUS_RING)}>
                review & sign
              </Link>
            </>
          ) : (
            item.message
          ),
        }))
      : [{ id: "quiet", at: "--:--:--", from: "BASE", to: "you", message: "Quiet on the radio. When a rule fires, it lands here first." }];

  const preview = rules[0] ? `${ruleCondition(rules[0])}: it just did.` : "BTC is below $90,000 (now $89,920).";

  return (
    <Page className="pb-16">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-5 sm:mb-8">
        <div className="min-w-0 max-w-3xl">
          <p className="label-tab mb-4">Sheet 08 · Radio · alerts in the app and on Telegram</p>
          <h1 className="text-[44px] font-bold leading-[1] tracking-[-0.03em] text-ink sm:text-[64px]">Tell me when.</h1>
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-2 text-pretty sm:text-[19px]">
            Price, funding, a rope near its crevasse, a fill, a bridge that landed. Say it as a sentence; Elyia watches it live and radios you. <span className="font-semibold text-ink">Alerts never trade.</span>
          </p>
        </div>
        <p className="max-w-[300px] border-l-[3px] border-rule pl-3 font-mono text-[12px] leading-relaxed text-ink-2">
          Watched while Elyia is open in this browser{mode === "testnet" ? " · testnet HyperCore prices (the practice wall)" : ""}. 24/7 delivery arrives with the Telegram bot.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.62fr)_minmax(340px,1fr)] xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <RuleBuilder coins={coins} ropeCoins={ropeCoins} readings={watch.readings} telegramLinked={false} priceWord={mode === "testnet" ? "testnet prices · funding hourly" : "HyperCore prices"} onCreate={add} />
          <RulesLog
            rules={rules}
            statuses={watch.statuses}
            now={now}
            onToggle={(rule) => useAlertStore.getState().updateRule(rule.id, { armed: !rule.armed })}
            onRemove={(rule) => useAlertStore.getState().removeRule(rule.id)}
          />
        </div>
        <aside className="flex min-w-0 flex-col gap-6" aria-label="Quick lines, feed and Telegram">
          <SignpostCluster
            caption="Quick lines · one tap arms"
            label="Quick alerts"
            blades={quick.map((blade, index) => ({
              destination: blade.destination,
              eta: blade.eta,
              detail: blade.detail,
              highlight: index === 0,
              onClick: () => add({ ...blade.rule, id: newRuleId(Date.now()), createdAt: Date.now() }),
            }))}
          />
          <RadioLog
            entries={radio}
            title={`In-app feed · ${feed.length} heard`}
            aside={
              feed.length > 0 ? (
                <button type="button" onClick={() => useAlertStore.getState().clearFeed()} className={cx("underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)}>
                  clear
                </button>
              ) : (
                "live"
              )
            }
            footer="alerts tell · the Guide drafts · you sign"
            maxHeight="340px"
          />
          <TelegramCard preview={preview} />
        </aside>
      </div>
    </Page>
  );
}
