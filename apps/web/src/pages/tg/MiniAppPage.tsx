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
import { Altimeter } from "../../topo/Altimeter";
import { Blaze } from "../../topo/Blaze";
import { Rope } from "../../topo/Rope";
import { TopoDefs } from "../../topo/TopoDefs";
import { useMeasuredWidth } from "../../topo/useMeasuredWidth";
import { ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { Skeleton } from "../../ui/Skeleton";
import { GuideRadio } from "../deck/DeckCards";
import { LayerSplitBar } from "../portfolio/parts/NetWorth";
import { pct, price, shortAddr, usdFull, usdShort, usdSigned } from "../portfolio/range/format";
import { dayChange } from "../portfolio/range/labels";
import { layerSplit, sortRopes } from "../portfolio/range/model";
import { EXAMPLE_ADDRESS } from "../portfolio/range/sample";
import { useRange, type RangeData } from "../portfolio/range/useRange";
import { campBulletin, isMuted, MUTE_MS, parseMutes, type CampBulletin } from "./camp";
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

/** The altimeter: net worth rolling digit by digit, today's move, the layer split. */
function AltimeterCard({ range }: { readonly range: RangeData }) {
  const [measure, width] = useMeasuredWidth<HTMLDivElement>(0);
  if (!range.snapshot) {
    return <Skeleton className="h-36 w-full" />;
  }
  const snapshot = range.snapshot;
  const value = usdFull(snapshot.totals.netWorthUsd);
  const size = width > 0 && width < value.length * 37 ? "sm" : "md";
  const today = dayChange(range.history);
  return (
    <section aria-label="Net worth" className="flex flex-col gap-3" ref={measure}>
      <div className="flex items-end justify-between gap-3">
        <p className="caption">
          Altimeter · net worth{range.source === "sample" ? <span className="ml-1.5 bg-signal px-1 text-signal-ink">sample</span> : null}
        </p>
        {today !== null ? (
          <p className="tnum text-right font-mono text-[12px] leading-tight text-ink-2">
            <span className={today >= 0 ? "text-up" : "text-down"}>{usdSigned(today)}</span>
            <span className="block">today</span>
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto scrollbar-none">
        <Altimeter value={value} label={range.source === "sample" ? "Net worth (sample)" : "Net worth"} size={size} markLatest />
      </div>
      <LayerSplitBar split={layerSplit(snapshot)} compact />
    </section>
  );
}

const TONE_STRIP: Readonly<Record<CampBulletin["tone"], string>> = {
  alert: "bg-signal text-signal-ink",
  caution: "bg-warn text-warn-on",
  calm: "bg-paper-2 text-ink",
};

function BulletinCard({ bulletin, onMute, sample }: { readonly bulletin: CampBulletin; readonly onMute: () => void; readonly sample: boolean }) {
  const now = useNow(60_000);
  return (
    <section aria-labelledby="camp-bulletin" className="el-rise border-2 border-rule bg-card shadow-hard">
      <header className={cx("flex items-center justify-between gap-3 border-b-2 border-rule px-3 py-2", TONE_STRIP[bulletin.tone])}>
        <h2 id="camp-bulletin" className="flex min-w-0 items-start gap-2 text-[14px] font-bold uppercase leading-tight tracking-[0.03em]">
          <span aria-hidden="true">{bulletin.tone === "calm" ? "◇" : "⚑"}</span>
          <span className="min-w-0 break-words">{bulletin.title}</span>
        </h2>
        <span className="tnum shrink-0 font-mono text-[11px] font-semibold">
          {new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          {sample ? " · sample" : ""}
        </span>
      </header>
      <p className="px-3 py-3 text-[15px] leading-snug text-ink">{bulletin.body}</p>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-2 px-3 pb-3">
        {bulletin.actions.map((action) =>
          action.kind === "mute" ? (
            <button key={action.label} type="button" onClick={onMute} className={cx("h-11 border-2 border-rule/40 px-2.5 font-sans text-[12px] font-bold uppercase tracking-[0.05em] text-ink-2 hover:border-rule hover:text-ink", FOCUS_RING)}>
              {action.label}
            </button>
          ) : action.href ? (
            <ButtonLink key={action.label} to={action.href} variant={action.kind === "primary" ? "primary" : "ink"} size="md" className="h-11 min-w-0 px-2 text-[12px]">
              {action.label}
            </ButtonLink>
          ) : (
            <button key={action.label} type="button" onClick={() => openOracle()} className={cx("col-span-3 h-11 border-2 border-rule bg-accent font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-accent-ink shadow-hard", FOCUS_RING)}>
              {action.label} →
            </button>
          ),
        )}
      </div>
      {bulletin.tone !== "calm" ? (
        <p className="flex items-center gap-2 border-t-1.5 border-dashed border-rule/50 px-3 py-1.5 font-mono text-[11px] text-ink-2">
          <Blaze grade={bulletin.grade as 1 | 2 | 3 | 4 | 5 | 6} size={11} /> drafts a route card · you sign in the deck · nothing signs here
        </p>
      ) : null}
    </section>
  );
}

function RopesCard({ range }: { readonly range: RangeData }) {
  const ropes = useMemo(() => sortRopes(range.ropes).slice(0, 4), [range.ropes]);
  return (
    <section aria-labelledby="camp-ropes" className="border-2 border-rule bg-card">
      <header className="flex items-center justify-between gap-3 border-b-1.5 border-rule px-3 py-2">
        <h2 id="camp-ropes" className="caption !text-ink">
          Ropes · {range.ropes.length}
          {range.source === "sample" ? " · sample" : ""}
        </h2>
        <span className="caption">nearest first</span>
      </header>
      {ropes.length === 0 ? (
        <p className="px-3 py-4 text-[14px] text-ink-2">No ropes out. Every position you open hangs here, from the crevasse to the flag.</p>
      ) : (
        <ul className="divide-y divide-rule/15">
          {ropes.map((rope) => (
            <li key={`${rope.dex}|${rope.coin}`}>
              <Link to={routeHref("trade", { market: rope.dex ? `${rope.dex}:${rope.coin}` : rope.coin })} className={cx("block px-3 pb-2 pt-2.5 hover:bg-paper-2/60", FOCUS_RING)}>
                <span className="tnum flex items-baseline justify-between gap-2 font-mono text-[13px]">
                  <span className="font-semibold text-ink">
                    <span className={rope.side === "long" ? "text-up" : "text-down"}>{rope.side === "long" ? "▲" : "▼"}</span> {rope.coin} {rope.leverage}×
                  </span>
                  <span className={rope.unrealizedPnl >= 0 ? "text-up" : "text-down"}>{usdSigned(rope.unrealizedPnl, true)}</span>
                  <span className={rope.band === "critical" || rope.band === "danger" ? "font-semibold text-down" : "text-ink-2"}>rope {rope.distance === null ? "∞" : pct(rope.distance)}</span>
                </span>
                <Rope variant="compact" symbol={rope.coin} side={rope.side} entry={rope.entryPx} mark={rope.markPx} liquidation={rope.liquidationPx} stop={rope.sl?.px ?? null} takeProfit={rope.tp?.px ?? null} formatPrice={price} />
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
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-2.5">
      {blades.map((blade, index) => (
        <Link
          key={blade.label}
          to={blade.to}
          className={cx(
            "el-signpost el-signpost--right el-swing relative flex min-h-[58px] flex-col justify-center border-2 border-rule py-1.5 pl-3 pr-7 text-left transition-transform duration-fast hover:translate-x-0.5",
            blade.lead ? "bg-signal text-signal-ink" : "bg-card text-ink",
            FOCUS_RING,
          )}
          style={{ ["--el-delay" as string]: `${140 + index * 90}ms` }}
        >
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-bold uppercase leading-tight tracking-[0.02em]">
            {blade.label}
            <Blaze grade={blade.grade} size={10} />
          </span>
          <span className="mt-0.5 truncate font-mono text-[10.5px] opacity-80">{blade.detail}</span>
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
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-2">
        <span className="font-semibold text-ink">watching {shortAddr(followed)}</span>
        <span>· read only · {source === "api" ? "via the Elyia API" : "live from HyperCore"}</span>
        <button type="button" className={cx("ml-auto underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)} onClick={() => onWatch(null)}>
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
      <div className="flex h-11 items-stretch border-2 border-rule bg-card">
        <label htmlFor="tg-watch" className="flex items-center bg-ink px-2.5 font-sans text-[12px] font-bold uppercase tracking-[0.05em] text-paper">
          Watch
        </label>
        <input id="tg-watch" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="0x… your address" autoComplete="off" spellCheck={false} aria-invalid={error || undefined} className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3" />
        <button type="submit" className={cx("border-l-2 border-rule px-3 font-sans text-[12px] font-bold uppercase tracking-[0.05em] text-ink", FOCUS_RING)}>
          Go
        </button>
      </div>
      <p className={cx("font-mono text-[11px]", error ? "text-down" : "text-ink-3")} role={error ? "alert" : undefined}>
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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t-2 border-rule bg-paper/95 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-[2px]">
      <div className="pointer-events-auto mx-auto max-w-[440px] px-4">
        <button type="button" onClick={() => openOracle()} className={cx("el-blade group flex h-14 w-full items-center gap-3 bg-signal pl-4 pr-9 text-left text-signal-ink", FOCUS_RING)}>
          <span className="shrink-0 whitespace-nowrap text-[19px] font-bold uppercase tracking-[0.04em]">Where to?</span>
          <span className="min-w-0 truncate font-mono text-[12px] opacity-75">long ETH 5x with 200 USDC…</span>
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

  return (
    <div className={cx("relative min-h-[100dvh] bg-paper text-ink", sheet === "night" ? "el-night" : "el-day")}>
      <TopoDefs />
      <aside className="pointer-events-none absolute left-[max(2.5rem,calc(50%-640px))] top-16 hidden w-[min(30vw,400px)] xl:block" aria-hidden="true">
        <p className="label-tab">Sheet 13 · the mini app · 390 first</p>
        <p className="mt-6 text-[56px] font-bold leading-[0.98] tracking-[-0.03em] text-ink">Base camp, in your pocket.</p>
        <p className="mt-5 text-[18px] leading-relaxed text-ink-2">Opened from Telegram, this page takes the chat&apos;s colours and puts WHERE TO? on Telegram&apos;s own main button. It reads and drafts; signing stays in your wallet.</p>
      </aside>
      <div className="mx-auto flex max-w-[440px] flex-col gap-4 px-4 pb-32 pt-3 xl:border-x-2 xl:border-rule xl:bg-paper xl:pt-5">
        <header className="flex items-center gap-3 border-b-2 border-rule pb-3">
          <ElyiaMark size={30} />
          <div className="min-w-0 flex-1">
            <p className="text-[19px] font-bold leading-none tracking-[-0.01em]">Elyia</p>
            <p className="mt-1 truncate font-mono text-[11px] text-ink-2">
              base-camp radio{telegram.firstName ? ` · BASE → ${telegram.firstName}` : ""}
            </p>
          </div>
          <span className="shrink-0 border-2 border-rule bg-signal px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] text-signal-ink">{mode === "testnet" ? "PRACTICE WALL" : "MAINNET"}</span>
          {telegram.scheme ? null : <ThemeToggle compact />}
        </header>

        <AltimeterCard range={range} />
        <WatchLine followed={followed} source={range.source} onWatch={setFollowed} />

        {range.snapshot ? (
          muted ? (
            <p className="flex items-center justify-between gap-3 border-2 border-dashed border-rule/50 px-3 py-2 font-mono text-[12px] text-ink-2">
              <span>“{bulletin.title}” muted for the hour</span>
              <button type="button" className={cx("underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)} onClick={() => setMutes((current) => ({ ...current, [bulletin.id]: 0 }))}>
                unmute
              </button>
            </p>
          ) : (
            <BulletinCard bulletin={bulletin} onMute={mute} sample={range.source === "sample"} />
          )
        ) : null}

        <RopesCard range={range} />
        <QuickBlades portfolioHref={portfolioHref} />
        <GuideRadio ropes={range.ropes} history={range.history} sample={range.source === "sample"} />

        <footer className="flex flex-col gap-2 pt-2 font-mono text-[11px] leading-relaxed text-ink-3">
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

/** "/tg": the Telegram Mini App. A compact base-camp radio: altimeter, the one bulletin that matters, ropes, quick blades, the radio log and WHERE TO?. */
export default function MiniAppPage() {
  return (
    <WalletProviders>
      <Camp />
    </WalletProviders>
  );
}
