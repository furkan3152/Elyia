import { useCallback, useEffect, useMemo, useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { Link } from "../../app/routes/Link";
import { useSearchParam } from "../../app/routes/useRoute";
import { WalletProviders } from "../../app/providers";
import { ElyiaMark } from "../../app/shell/ElyiaMark";
import { ThemeToggle } from "../../app/shell/ThemeToggle";
import { readSessionStorage, readStorage, removeStorage, writeSessionStorage, writeStorage } from "../../app/state/storage";
import { THEME_COLORS } from "../../app/state/uiPrefs";
import { useUiStore } from "../../app/state/uiStore";
import { useResolvedTheme } from "../../app/state/useTheme";
import { useNow } from "../../hooks/useNow";
import { intentHref } from "../../oracle/preview";
import { openOracle } from "../../oracle/oracleStore";
import { ElyLoader } from "../../pixel/ElyLoader";
import { PixelAltimeter } from "../../pixel/PixelAltimeter";
import { PixelRope } from "../../pixel/PixelRope";
import { TopoBackdrop } from "../../pixel/TopoBackdrop";
import { Blaze } from "../../topo/Blaze";
import { TopoDefs } from "../../topo/TopoDefs";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Tag } from "../../ui/Badge";
import type { Mood } from "../agent/guide/mood";
import { GuideStage } from "../agent/parts/GuideStage";
import { pct, price, shortAddr, usdFull, usdShort, usdSigned } from "../portfolio/range/format";
import { dayChange } from "../portfolio/range/labels";
import { layerSplit, sortRopes } from "../portfolio/range/model";
import { EXAMPLE_ADDRESS } from "../portfolio/range/sample";
import { useRange, type RangeData } from "../portfolio/range/useRange";
import { campBulletin, isMuted, MUTE_MS, parseMutes, type CampBulletin } from "./camp";
import { CampRadio, LayerSkyline } from "./parts";
import { readTelegram, tryCall, type TelegramContext } from "./telegram";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const WATCH_KEY = "elyia.tg.watch";
const MUTE_KEY = "elyia.tg.mutes";

/* Followed address: ?as=, then Telegram's startapp=as_0x…, then the one saved here. */
function useFollowed(telegram: TelegramContext): readonly [string | null, (address: string | null) => void] {
  const asParam = useSearchParam("as");
  const fromUrl = asParam && ADDRESS.test(asParam) ? asParam.toLowerCase() : null;
  const [saved, setSaved] = useState<string | null>(() => {
    const raw = readStorage(WATCH_KEY);
    return raw && ADDRESS.test(raw) ? raw.toLowerCase() : null;
  });
  // "stop" wins over the link that opened the page, until a new address is chosen here.
  const [overridden, setOverridden] = useState(false);
  const set = useCallback((address: string | null) => {
    if (address) writeStorage(WATCH_KEY, address);
    else removeStorage(WATCH_KEY);
    setSaved(address);
    setOverridden(true);
  }, []);
  return [overridden ? saved : (fromUrl ?? telegram.startAddress ?? saved), set] as const;
}

/** The altimeter: net worth rolling digit by digit, today's move, the layer split as a pixel skyline. */
function AltimeterCard({ range }: { readonly range: RangeData }) {
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(0);
  if (!range.snapshot) {
    return (
      <section className="flex justify-center bg-card py-6 px-frame px-drop" aria-label="Net worth">
        <ElyLoader label="Surveying the range" />
      </section>
    );
  }
  const snapshot = range.snapshot;
  const value = usdFull(snapshot.totals.netWorthUsd);
  const size = width > 0 && width < value.length * 34 ? "sm" : "md";
  const today = dayChange(range.history);
  return (
    <section aria-label="Net worth" className="flex flex-col bg-card px-frame px-drop" ref={measure}>
      <header className="flex items-center justify-between gap-3 border-b-4 border-rule bg-paper-2 px-3 py-2">
        <h2 className="font-tag text-[11px] uppercase text-ink">
          Altimeter · net worth{range.source === "sample" ? <span className="ml-1.5 bg-signal px-1 text-signal-ink">sample</span> : null}
        </h2>
        {today !== null ? (
          <p className={cx("tnum font-mono text-[12px]", today >= 0 ? "text-up" : "text-down")}>
            {usdSigned(today)} <span className="text-ink-3">today</span>
          </p>
        ) : null}
      </header>
      <div className="flex flex-col items-center gap-4 px-3 pb-4 pt-4">
        <div className="max-w-full overflow-x-auto scrollbar-none">
          <PixelAltimeter value={value} label={range.source === "sample" ? "Net worth (sample)" : "Net worth"} size={size} markLatest />
        </div>
        <LayerSkyline split={layerSplit(snapshot)} className="w-full" />
      </div>
    </section>
  );
}

/** Ely on the radio: the camp's one bulletin decides the mood. */
function campMood(bulletin: CampBulletin, ropes: number, surveying: boolean, sample: boolean): Mood {
  const word = sample ? " (sample)" : "";
  if (surveying) return { state: "climb", word: "Surveying", line: "Reading the range…" };
  if (bulletin.tone === "alert") return { state: "worry", word: "Holding on", line: `${bulletin.title.replace(/^Rope fraying · /u, "")} is fraying${word}.` };
  if (bulletin.tone === "caution") return { state: "talk", word: "On the radio", line: `${bulletin.title}${word}.` };
  if (ropes === 0) return { state: "sleep", word: "All quiet", line: `No ropes out${word}.` };
  return { state: "idle", word: "Listening", line: `${ropes} rope${ropes === 1 ? "" : "s"} out, all with slack${word}.` };
}

const TONE_TAB: Readonly<Record<CampBulletin["tone"], string>> = {
  alert: "bg-down text-card",
  caution: "bg-signal text-signal-ink",
  calm: "bg-paper-2 text-ink",
};

function BulletinCard({ bulletin, onMute, sample }: { readonly bulletin: CampBulletin; readonly onMute: () => void; readonly sample: boolean }) {
  const now = useNow(60_000);
  return (
    <section aria-labelledby="camp-bulletin" className="el-rise relative mt-3 bg-card px-frame px-drop">
      <span aria-hidden="true" className="absolute -top-3 left-3 inline-flex h-6 items-center bg-signal px-2 font-tag text-[11px] uppercase text-signal-ink px-frame-thin">
        Ely → you · {new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        {sample ? " · sample" : ""}
      </span>
      <header className={cx("flex items-center gap-2 border-b-4 border-rule px-3 pb-2 pt-5", TONE_TAB[bulletin.tone])}>
        <span aria-hidden="true" className="font-tag text-[12px]">
          {bulletin.tone === "calm" ? "◇" : "⚑"}
        </span>
        <h2 id="camp-bulletin" className="min-w-0 break-words font-display text-[18px] font-bold leading-tight">
          {bulletin.title}
        </h2>
      </header>
      <p className="px-3 py-3 text-[15px] leading-snug text-ink">{bulletin.body}</p>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-4 px-3 pb-4 pt-1">
        {bulletin.actions.map((action) =>
          action.kind === "mute" ? (
            <button key={action.label} type="button" onClick={onMute} className={cx("h-11 bg-card px-2.5 font-tag text-[11px] uppercase text-ink-2 px-frame-thin px-press hover:text-ink", FOCUS_RING)}>
              {action.label}
            </button>
          ) : action.href ? (
            <ButtonLink key={action.label} to={action.href} variant={action.kind === "primary" ? "primary" : "ink"} size="md" className="h-11 min-w-0 px-2 text-[14px]">
              {action.label}
            </ButtonLink>
          ) : (
            <button key={action.label} type="button" onClick={() => openOracle()} className={cx("col-span-3 h-12 bg-signal font-display text-[18px] font-bold text-signal-ink px-frame px-drop px-press", FOCUS_RING)}>
              {action.label} ▸
            </button>
          ),
        )}
      </div>
      {bulletin.tone !== "calm" ? (
        <p className="flex items-center justify-center gap-2 border-t-4 border-dashed border-rule/30 px-3 py-2 text-center font-mono text-[11px] text-ink-2">
          <Blaze grade={bulletin.grade as 1 | 2 | 3 | 4 | 5 | 6} size={11} /> drafts a route card · you sign in the deck
        </p>
      ) : null}
    </section>
  );
}

function RopesCard({ range }: { readonly range: RangeData }) {
  const ropes = useMemo(() => sortRopes(range.ropes).slice(0, 4), [range.ropes]);
  return (
    <section aria-labelledby="camp-ropes" className="bg-card px-frame px-drop">
      <header className="flex items-center justify-between gap-3 border-b-4 border-rule bg-paper-2 px-3 py-2">
        <h2 id="camp-ropes" className="font-tag text-[11px] uppercase text-ink">
          Ropes · {range.ropes.length}
          {range.source === "sample" ? " · sample" : ""}
        </h2>
        <span className="font-tag text-[11px] uppercase text-ink-3">nearest first</span>
      </header>
      {ropes.length === 0 ? (
        <p className="px-3 py-5 text-center text-[14px] text-ink-2">No ropes out. Every position you open hangs here, from the crevasse to the flag.</p>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-rule/20">
          {ropes.map((rope) => (
            <li key={`${rope.dex}|${rope.coin}`}>
              <Link to={routeHref("trade", { market: rope.dex ? `${rope.dex}:${rope.coin}` : rope.coin })} className={cx("block px-3 pb-3 pt-3 hover:bg-paper-2/60", FOCUS_RING)}>
                <span className="tnum mb-2 flex items-baseline justify-between gap-2 font-mono text-[13px]">
                  <span className="font-semibold text-ink">
                    <span className={rope.side === "long" ? "text-up" : "text-down"}>{rope.side === "long" ? "▲" : "▼"}</span> {rope.coin} {rope.leverage}×
                  </span>
                  <span className={rope.unrealizedPnl >= 0 ? "text-up" : "text-down"}>
                    {usdSigned(rope.unrealizedPnl, true)}
                  </span>
                  <span className={cx("font-tag text-[11px] uppercase", rope.band === "critical" || rope.band === "danger" ? "text-down" : "text-ink-2")}>rope {rope.distance === null ? "∞" : pct(rope.distance)}</span>
                </span>
                <PixelRope variant="compact" symbol={rope.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuickBlades({ portfolioHref }: { readonly portfolioHref: string }) {
  const blades = [
    { label: "Long/short", detail: "HyperCore · 0.2 s", to: routeHref("trade"), grade: 3 as const, lead: true },
    { label: "To Summit", detail: "bridge HYPE up", to: intentHref("bridge 20 HYPE to Elysium"), grade: 2 as const, lead: true },
    { label: "Stake HYPE", detail: "kHYPE · Kinetiq", to: intentHref("stake 10 HYPE to kHYPE"), grade: 1 as const, lead: false },
    { label: "Sweep dust", detail: "dust → USDC", to: `${portfolioHref}#jobs`, grade: 1 as const, lead: false },
  ];
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-x-5 gap-y-6">
      {blades.map((blade) => (
        <Link
          key={blade.label}
          to={blade.to}
          className={cx("flex min-h-[64px] flex-col items-center justify-center px-2 py-2 text-center px-frame px-drop px-press", blade.lead ? "bg-signal text-signal-ink" : "bg-card text-ink", FOCUS_RING)}
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap font-display text-[16px] font-bold leading-tight">
            {blade.label}
            <Blaze grade={blade.grade} size={10} />
          </span>
          <span className="mt-0.5 truncate font-mono text-[11px] opacity-80">{blade.detail}</span>
        </Link>
      ))}
    </nav>
  );
}

function WatchLine({ followed, source, onWatch }: { readonly followed: string | null; readonly source: RangeData["source"]; readonly onWatch: (address: string | null) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  if (followed) {
    return (
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-mono text-[11px] text-ink-2">
        <span className="font-tag text-[11px] uppercase text-ink">watching {shortAddr(followed)}</span>
        <span>· read only · {source === "api" ? "via the Elyia API" : "live from HyperCore"}</span>
        <button type="button" className={cx("underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)} onClick={() => onWatch(null)}>
          stop
        </button>
      </p>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = draft.trim();
        if (!ADDRESS.test(value)) {
          setError(true);
          return;
        }
        setError(false);
        onWatch(value.toLowerCase());
      }}
      className="flex flex-col gap-1.5"
    >
      <div className="flex h-11 items-stretch bg-card px-frame-thin focus-within:outline-dashed focus-within:outline-4 focus-within:outline-offset-[6px] focus-within:outline-signal">
        <label htmlFor="tg-watch" className="flex items-center bg-ink px-2.5 font-tag text-[11px] uppercase text-paper">
          Watch
        </label>
        <input id="tg-watch" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="0x… your address" autoComplete="off" spellCheck={false} aria-invalid={error || undefined} className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3" />
        <button type="submit" className={cx("border-l-2 border-rule bg-accent px-3 font-display text-[15px] font-bold text-accent-ink", FOCUS_RING)}>
          Go
        </button>
      </div>
      <p className={cx("text-center font-mono text-[11px]", error ? "text-down" : "text-ink-3")} role={error ? "alert" : undefined}>
        {error ? "0x followed by 40 hex characters." : (
          <>
            Showing a sample range. Read only, nothing signs here ·{" "}
            <button type="button" className={cx("underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)} onClick={() => onWatch(EXAMPLE_ADDRESS.toLowerCase())}>
              try a live one
            </button>
          </>
        )}
      </p>
    </form>
  );
}

/** The fixed WHERE TO? bar; inside Telegram, Telegram's own main button carries it instead. */
function WhereToBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t-4 border-rule bg-paper pb-[max(env(safe-area-inset-bottom),14px)] pt-4">
      <div className="pointer-events-auto mx-auto max-w-[440px] px-5">
        <button type="button" onClick={() => openOracle()} className={cx("flex h-14 w-full items-center justify-center gap-3 bg-signal px-4 text-signal-ink px-frame px-drop px-press", FOCUS_RING)}>
          <span className="shrink-0 whitespace-nowrap font-display text-[22px] font-bold">Where to?</span>
          <span className="min-w-0 truncate font-mono text-[12px] opacity-80">long ETH 5x with 200 USDC…</span>
        </button>
      </div>
    </div>
  );
}

function Camp() {
  const telegram = useMemo(() => readTelegram(typeof window === "undefined" ? null : window), []);
  const [followed, setFollowed] = useFollowed(telegram);
  const range = useRange(followed);
  const appTheme = useResolvedTheme();
  const mode = useUiStore((state) => state.mode);
  const sheet = telegram.scheme ?? (appTheme === "dark" ? "night" : "day");
  const now = useNow(60_000);
  const [mutes, setMutes] = useState<Record<string, number>>(() => parseMutes(readSessionStorage(MUTE_KEY), Date.now()));
  const portfolioHref = followed ? routeHref("portfolio", { address: followed }) : routeHref("portfolio");

  const bulletin = useMemo(
    () =>
      campBulletin(range.ropes, {
        intent: (sentence) => intentHref(sentence),
        trade: (coin) => routeHref("trade", { market: coin }),
      }),
    [range.ropes],
  );
  const muted = isMuted(mutes, bulletin.id, now);
  const mute = () => {
    const next = { ...mutes, [bulletin.id]: Date.now() + MUTE_MS };
    setMutes(next);
    writeSessionStorage(MUTE_KEY, JSON.stringify(next));
  };

  // Telegram: tell it we are ready, take the full height, match its chrome to our paper, carry WHERE TO? on its main button.
  useEffect(() => {
    const app = telegram.app;
    if (!app) return undefined;
    tryCall(() => app.ready?.());
    tryCall(() => app.expand?.());
    const paper = THEME_COLORS[sheet === "night" ? "dark" : "light"];
    tryCall(() => app.setHeaderColor?.(paper));
    tryCall(() => app.setBackgroundColor?.(paper));
    const main = app.MainButton;
    const open = () => openOracle();
    if (main && telegram.inside) {
      tryCall(() => main.setParams?.({ text: "WHERE TO?", color: "#F2C200", text_color: "#16201B", is_visible: true }));
      tryCall(() => main.onClick?.(open));
    }
    return () => {
      if (main) {
        tryCall(() => main.offClick?.(open));
        tryCall(() => main.hide?.());
      }
    };
  }, [telegram, sheet]);

  const surveying = range.snapshot === null;
  const mood = campMood(bulletin, range.ropes.length, surveying, range.source === "sample");

  return (
    <div className={cx("relative isolate min-h-[100dvh] bg-paper text-ink", sheet === "night" ? "el-night" : "el-day")}>
      <TopoDefs />
      <TopoBackdrop />
      <header className="relative mx-auto hidden max-w-[640px] flex-col items-center px-6 pb-10 pt-14 text-center xl:flex">
        <Tag>Sheet 13 · the mini app · 390 first</Tag>
        <h1 className="mt-5 font-display text-[56px] font-bold leading-[1.02] text-ink">Base camp, in your pocket.</h1>
        <p className="mt-4 max-w-[560px] text-[17px] leading-relaxed text-ink-2">Opened from Telegram, this page takes the chat&apos;s colours and puts WHERE TO? on Telegram&apos;s own main button. It reads and drafts; signing stays in your wallet.</p>
      </header>
      <div className="relative mx-auto flex max-w-[440px] flex-col gap-7 px-5 pb-36 pt-4 xl:mb-16 xl:bg-paper xl:pt-6 xl:shadow-[0_-4px_0_0_rgb(var(--rule)),0_4px_0_0_rgb(var(--rule)),-4px_0_0_0_rgb(var(--rule)),4px_0_0_0_rgb(var(--rule)),12px_16px_0_0_rgb(var(--shadow-ink))]">
        <header className="flex items-center gap-3 border-b-4 border-rule pb-3">
          <ElyiaMark size={30} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[22px] font-bold leading-none">Elyia</p>
            <p className="mt-1 truncate font-tag text-[10px] uppercase text-ink-2">
              base-camp radio{telegram.firstName ? ` · BASE → ${telegram.firstName}` : ""}
            </p>
          </div>
          <span className="shrink-0 bg-signal px-1.5 py-0.5 font-tag text-[10px] uppercase text-signal-ink px-frame-thin">{mode === "testnet" ? "Practice wall" : "Mainnet"}</span>
          {telegram.scheme ? null : <ThemeToggle compact />}
        </header>

        <div className="-mx-5 overflow-hidden">
          <GuideStage mood={mood} pixelSize={3} />
        </div>

        {range.snapshot ? (
          muted ? (
            <p className="flex items-center justify-between gap-3 bg-card px-3 py-2 font-mono text-[12px] text-ink-2 px-frame-thin">
              <span>“{bulletin.title}” muted for the hour</span>
              <button type="button" className={cx("font-tag text-[11px] uppercase underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)} onClick={() => setMutes((current) => ({ ...current, [bulletin.id]: 0 }))}>
                unmute
              </button>
            </p>
          ) : (
            <BulletinCard bulletin={bulletin} onMute={mute} sample={range.source === "sample"} />
          )
        ) : null}

        <AltimeterCard range={range} />
        <WatchLine followed={followed} source={range.source} onWatch={setFollowed} />
        <RopesCard range={range} />
        <QuickBlades portfolioHref={portfolioHref} />
        <CampRadio ropes={range.ropes} history={range.history} sample={range.source === "sample"} />

        <footer className="flex flex-col items-center gap-2 pt-2 text-center font-mono text-[11px] leading-relaxed text-ink-3">
          <p>
            Signing happens in your own wallet, in the deck. This radio reads and drafts; it never signs, never withdraws.{" "}
            <Link to={followed ? `${routeHref("deck")}?as=${followed}` : routeHref("deck")} className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4", FOCUS_RING)}>
              Open the full deck →
            </Link>
          </p>
          <p>{range.snapshot ? `net worth ${usdShort(range.snapshot.totals.netWorthUsd)} · reference prices from HyperCore mainnet` : "surveying…"}</p>
        </footer>
      </div>
      {telegram.inside && telegram.app?.MainButton ? null : <WhereToBar />}
    </div>
  );
}

/** "/tg": the Telegram Mini App, a pixel base-camp radio (390 first): Ely on the radio in the bulletin's mood, the one bulletin that matters, the altimeter with the layer skyline, ropes, quick blades, the radio log and WHERE TO?. */
export default function MiniAppPage() {
  return (
    <WalletProviders>
      <Camp />
    </WalletProviders>
  );
}
