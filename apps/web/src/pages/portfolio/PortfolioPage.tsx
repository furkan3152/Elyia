import "../../features/ely/ely.css";

import type { NetworkKey } from "@elyia/core/networks";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { useRoute, useRouteParam } from "../../app/routes/useRoute";
import { useAutomations, useInsights } from "../../features/ely/agentApi";
import { useMediaQuery, useShellHeight } from "../../features/ely/hooks";
import { useWalletSession } from "../../features/session/useWalletSession";
import { describeError } from "../../lib/api";
import { ElyLoader } from "../../pixel/ElyLoader";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EXAMPLE_ADDRESS } from "./range/sample";
import { useRange } from "./range/useRange";
import { insightViews } from "./v2/model";
import { SAMPLE_INSIGHTS, SAMPLE_PNL } from "./v2/sample";
import { AccountBar } from "./workspace/AccountBar";
import { ElyPanel } from "./workspace/ElyPanel";
import { MapTab } from "./workspace/MapTab";
import { tabForKey, TABS, type WorkspaceTab } from "./workspace/model";
import { SignDialog, type SignRequest } from "./workspace/SignDialog";
import { ActivityTab, BalancesTab, PositionsTab } from "./workspace/Tables";
import { usePortfolioChat } from "./workspace/usePortfolioChat";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const COMPOSER_ID = "ely-composer";

type View = WorkspaceTab | "ely";

/** Keys typed into a field are the field's, not the page's. */
function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable));
}

/**
 * "/app/portfolio/:address?": the portfolio workspace. One screen, like Ask
 * Ely: the account bar (who, net worth, today, the Floor / Ridge / Summit
 * split, rope risk, actions) over the tabs Map | Positions | Balances |
 * Activity, and Ely docked beside them (what Ely noticed, the conversation
 * about this range, automations, the trust line). On phones Ely is a tab
 * with the count of what it noticed. Without a wallet it teaches with a
 * labelled sample; every draft is signed in the wallet, nothing auto-signs.
 * Keys: 1–4 pick a tab, / asks Ely.
 */
export default function PortfolioPage() {
  const param = useRouteParam("address");
  const { location } = useRoute();
  const { address: connected } = useAccount();
  const invalid = param !== undefined && !ADDRESS.test(param);
  const followed = invalid ? null : (param?.toLowerCase() ?? connected?.toLowerCase() ?? null);
  const own = followed !== null && connected !== undefined && followed === connected.toLowerCase();
  const range = useRange(followed);
  const sample = range.source === "sample";
  const session = useWalletSession();
  const token = own ? session.token : null;
  const insights = useInsights(sample ? null : followed);
  const automations = useAutomations(token);
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const phone = !useMediaQuery("(min-width: 768px)", true);
  const height = useShellHeight(phone);

  const insightsSample = sample || (insights.isError && !insights.data);
  const insightList = insightsSample ? SAMPLE_INSIGHTS : (insights.data?.insights ?? []);
  const livePnl = insights.data?.insights.find((insight) => insight.kind === "explain-pnl")?.figures ?? null;
  const pnl = sample ? SAMPLE_PNL : livePnl;
  const noticed = insightViews(insightList).length;
  const network: NetworkKey = range.mode === "mainnet" ? "hypercore-mainnet" : "hypercore-testnet";
  const chatAddress = followed ?? EXAMPLE_ADDRESS;
  const chat = usePortfolioChat({ address: chatAddress, session: token, sample, pnl });

  const [tab, setTab] = useState<View>("map");
  const view: View = wide && tab === "ely" ? "map" : tab;
  const [draft, setDraft] = useState<SignRequest | null>(null);
  const [automationsOpen, setAutomationsOpen] = useState(false);

  const askEly = () => {
    if (!wide) setTab("ely");
    requestAnimationFrame(() => document.getElementById(COMPOSER_ID)?.focus());
  };

  // #automations (the composer's Autopilot link from Ask Ely): open the switches in the Ely panel.
  const hash = location.hash;
  const [shownHash, setShownHash] = useState<string | null>(null);
  if (hash !== shownHash) {
    setShownHash(hash);
    if (hash === "#automations") {
      setAutomationsOpen(true);
      if (!wide) setTab("ely");
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        if (!wide) setTab("ely");
        requestAnimationFrame(() => document.getElementById(COMPOSER_ID)?.focus());
        return;
      }
      const next = tabForKey(event.key);
      if (next) {
        event.preventDefault();
        setTab(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide]);

  const snapshot = range.snapshot;
  const tabs: readonly { readonly id: View; readonly label: string; readonly key: string | null }[] = wide ? TABS : [...TABS, { id: "ely", label: "Ely", key: null }];

  const panel = (
    <ElyPanel
      insights={insightList}
      insightsSample={insightsSample}
      insightsLoading={!sample && insights.isPending}
      insightsError={!sample && insights.isError ? describeError(insights.error) : null}
      chat={chat}
      pnl={pnl}
      pnlSample={sample || livePnl === null}
      followed={sample ? null : followed}
      chatAddress={chatAddress}
      session={session}
      token={token}
      own={own}
      phone={phone}
      automationsOpen={automationsOpen}
      onAutomationsOpen={setAutomationsOpen}
      onDraft={setDraft}
    />
  );

  const tabBody = !snapshot ? (
    <div className="grid h-full min-h-[240px] place-items-center" aria-busy="true">
      <ElyLoader label="Surveying the range" size="lg" />
    </div>
  ) : view === "map" ? (
    <MapTab snapshot={snapshot} ropes={range.ropes} sample={sample} phone={phone} />
  ) : view === "positions" ? (
    <PositionsTab ropes={range.ropes} insights={insightList} network={network} sample={sample} onDraft={(action) => setDraft({ title: action.title, source: action.source })} />
  ) : view === "balances" ? (
    <BalancesTab snapshot={snapshot} />
  ) : view === "activity" ? (
    <ActivityTab history={range.history} />
  ) : null;

  return (
    <div className="ely2 ws" style={{ height, gridTemplateColumns: wide ? "minmax(0, 1fr) clamp(380px, 32vw, 480px)" : "minmax(0, 1fr)" }}>
      <div className={cx("ws-main", view === "ely" && "is-ely")}>
        {invalid ? (
          <p role="alert" className="note !text-down">
            “{param.slice(0, 64)}” is not an address. Showing the sample range; paste 0x followed by 40 hex characters.
          </p>
        ) : null}
        {range.source === "browser" && view !== "ely" ? (
          <p className="note">
            <b className="text-ink">The Elyia survey is not answering</b> ({range.apiProblem}). The range is read in your browser; Ely&apos;s insights show a labelled sample until it is back.
          </p>
        ) : null}
        {snapshot && view !== "ely" ? (
          <AccountBar
            snapshot={snapshot}
            history={range.history}
            ropes={range.ropes}
            followed={sample ? null : followed}
            own={own}
            connected={Boolean(connected)}
            source={range.source}
            testnet={range.mode === "testnet"}
            live={range.live}
            automationsOn={automations.data ? automations.data.automations.filter((entry) => entry.enabled).length : null}
            phone={phone}
            onAskEly={askEly}
          />
        ) : null}
        <section className={cx("ws-tabs", view === "ely" ? "is-ely" : "fr")} aria-label="Portfolio">
          <div className="ws-tabbar" role="tablist" aria-label="Portfolio views">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`ws-tab-${entry.id}`}
                aria-selected={view === entry.id}
                aria-controls="ws-tabpanel"
                tabIndex={view === entry.id ? 0 : -1}
                aria-keyshortcuts={entry.key ?? undefined}
                onClick={() => setTab(entry.id)}
                onKeyDown={(event) => {
                  const index = tabs.findIndex((item) => item.id === entry.id);
                  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  if (!step) return;
                  event.preventDefault();
                  const next = tabs[(index + step + tabs.length) % tabs.length]!;
                  setTab(next.id);
                  document.getElementById(`ws-tab-${next.id}`)?.focus();
                }}
                className={cx("ws-tab", FOCUS_RING)}
              >
                {entry.label}
                {entry.id === "ely" && noticed > 0 ? <span className="badge num">{noticed}</span> : null}
                {entry.key && !phone ? <span className="kbd" aria-hidden="true">{entry.key}</span> : null}
              </button>
            ))}
            {wide ? <span className="t-tag t-faint ml-auto hidden pr-1 !text-[9px] xl:inline">1–4 views · / ask Ely</span> : null}
          </div>
          <div id="ws-tabpanel" role="tabpanel" aria-labelledby={`ws-tab-${view}`} className={cx("ws-body", view === "ely" && "is-ely")}>
            {view === "ely" ? panel : tabBody}
          </div>
        </section>
      </div>
      {wide ? panel : null}
      <SignDialog request={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
