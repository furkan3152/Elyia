import { useEffect, useMemo, useRef } from "react";
import { useAccount } from "wagmi";

import { routeHref } from "../../app/routes/routeTable";
import { Link } from "../../app/routes/Link";
import { Cards, Page, Section, Split } from "../../pixel/layout";
import { ElyEmpty } from "../../pixel/ElyEmpty";
import { PixelGlyph } from "../../pixel/PixelGlyph";
import { useUiStore } from "../../app/state/uiStore";
import { useAccountFeeds } from "../../features/trading/useAccountFeeds";
import { useMarketCatalog } from "../../features/trading/useMarketData";
import { usePositionRopes } from "../../features/trading/useTopoData";
import { useNow } from "../../hooks/useNow";
import { RadioLog, type RadioEntry } from "../../topo/RadioLog";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { useAlertStore } from "./model/alertStore";
import { newRuleId, ruleCondition, type AlertRule } from "./model/rules";
import { useRuleWatch } from "./model/useRuleWatch";
import { GLYPHS } from "./model/glyphs";
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

  const builder = useRef<HTMLDivElement>(null);
  const toBuilder = () => builder.current?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <Page className="!pt-0">
      <Section
        level={1}
        tag="Sheet 08 · Radio · alerts in the app and on Telegram"
        title="Tell me when."
        lede={
          <>
            Price, funding, a rope near its crevasse, a fill, a bridge that landed. Say it as a sentence; Elyia watches it live and radios you. <span className="font-semibold text-ink">Alerts never trade.</span>
          </>
        }
        actions={
          <p className="bg-card px-3 py-1.5 text-center font-tag text-[11px] uppercase text-ink-2 px-frame-thin">
            Watched while Elyia is open{mode === "testnet" ? " · testnet prices" : ""} · 24/7 with the Telegram bot
          </p>
        }
      >
        <div ref={builder} className="scroll-mt-28">
          <RuleBuilder coins={coins} ropeCoins={ropeCoins} readings={watch.readings} telegramLinked={false} priceWord={mode === "testnet" ? "testnet prices · funding hourly" : "HyperCore prices"} onCreate={add} />
        </div>
      </Section>

      <Section id="rules" tag={`Your rules · ${rules.length} · ${rules.filter((rule) => rule.armed).length} armed · this device`} title="Every rule is a trail." lede="Ely stands where the reading is now; your line is the flag. The rope behind is the way already climbed. When Ely reaches the flag, it fires.">
        <RulesLog
          rules={rules}
          statuses={watch.statuses}
          now={now}
          onBuild={toBuilder}
          onToggle={(rule) => useAlertStore.getState().updateRule(rule.id, { armed: !rule.armed })}
          onRemove={(rule) => useAlertStore.getState().removeRule(rule.id)}
        />
      </Section>

      <Section id="quick" tag="Quick lines · one tap arms" title="From the market, right now." lede="Four lines read off the live market and your ropes. One tap arms each; tune it later in the builder.">
        <Cards n={4} as="ul">
          {quick.map((blade, index) => (
            <li key={blade.destination} className="flex">
              <button
                type="button"
                onClick={() => add({ ...blade.rule, id: newRuleId(Date.now()), createdAt: Date.now() })}
                className={cx("flex w-full flex-col items-center gap-3 px-4 pb-4 pt-5 text-center px-frame px-drop px-press", index === 0 ? "bg-signal text-signal-ink" : "bg-card text-ink", FOCUS_RING)}
              >
                <span className="inline-flex bg-card p-1.5 px-frame-thin">
                  <PixelGlyph rows={GLYPHS[blade.rule.kind]} scale={3} label={null} />
                </span>
                <span className="font-display text-[19px] font-bold leading-tight">{blade.destination}</span>
                <span className={cx("font-mono text-[12px]", index === 0 ? "text-signal-ink" : "text-ink-2")}>{blade.detail}</span>
                <span className="mt-auto font-tag text-[11px] uppercase">Arm it ▸</span>
              </button>
            </li>
          ))}
        </Cards>
      </Section>

      <Section id="radio" tag="Radio · what fired · where it goes" title="Heard at base camp." lede="Everything that fired lands in this feed first. Link Telegram and it reaches your pocket too; approving still opens Elyia to sign.">
        <Split>
          {feed.length === 0 ? (
            <section className="flex flex-col bg-card px-frame px-drop" aria-labelledby="feed-title">
              <header className="flex items-center justify-between gap-3 border-b-4 border-rule bg-paper-2 px-4 py-2.5">
                <h3 id="feed-title" className="font-tag text-[12px] uppercase text-ink">
                  In-app feed · 0 heard
                </h3>
                <span className="font-tag text-[11px] uppercase text-up">● live</span>
              </header>
              <div className="flex flex-1 items-center justify-center">
                <ElyEmpty compact title="Quiet on the radio" description="When a rule fires, it lands here first, with the reading that tripped it." />
              </div>
              <footer className="border-t-4 border-dashed border-rule/30 px-4 py-2 text-center font-mono text-[11px] text-ink-3">alerts tell · the Guide drafts · you sign</footer>
            </section>
          ) : (
          <RadioLog
            className="px-drop"
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
            maxHeight="360px"
          />
          )}
          <TelegramCard preview={preview} />
        </Split>
      </Section>
    </Page>
  );
}
