import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { useSearchParam } from "../../app/routes/useRoute";
import { Page } from "../../app/shell/Page";
import { useUiStore } from "../../app/state/uiStore";
import { EnableTradingDialog } from "../../features/agentKey/EnableTradingDialog";
import { useAgentKey } from "../../features/agentKey/useAgentKey";
import type { SubmitResult, TradePlan } from "../../features/trading/executor";
import { bookSummary, effectiveRuleBook } from "../../features/trading/guard";
import { useTradeStore } from "../../features/trading/tradeStore";
import { useNow } from "../../hooks/useNow";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { intentHref } from "../../oracle/preview";
import { cx } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { useAlertStore } from "../alerts/model/alertStore";
import { newRuleId } from "../alerts/model/rules";
import { useRuleWatch } from "../alerts/model/useRuleWatch";
import { shortAddr } from "../portfolio/range/format";
import { SAMPLE_ADDRESS } from "../portfolio/range/sample";
import { useRange } from "../portfolio/range/useRange";
import { buildFacts, morningBulletin } from "./guide/facts";
import { guideId, useGuideStore, type GuideMessage } from "./guide/guideStore";
import { answer, px, standingReply, STARTERS, type Proposal } from "./guide/planner";
import { useGuideSigner } from "./guide/useGuideSigner";
import { Composer } from "./parts/Composer";
import { Conversation } from "./parts/Conversation";
import { AuditLog, KillSwitch, LicenceCard, MorningBulletin, StandingOrders } from "./parts/Instruments";
import { SignDialog } from "./parts/SignDialog";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SOURCE_WORD = { api: "live · Elyia survey", browser: "live · straight from HyperCore", sample: "sample range" } as const;
const OPENING = "what's my riskiest rope right now?";

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

/**
 * "/app/agent": the Guide. It reads the followed range (ropes, exposure,
 * funding, history) with a deterministic local planner, answers in plain
 * words with the readings it took, and drafts proposals you sign with your
 * trade-only key (anchor, halve), route cards, alerts and standing orders.
 * Beside it: the keeper licence (opt-in, draft until the keeper is online),
 * the standing orders, the audit radio log and the kill switch.
 */
export default function AgentPage() {
  const mode = useUiStore((state) => state.mode);
  const asParam = useSearchParam("as");
  const { address } = useAccount();
  const connected = address ? address.toLowerCase() : null;
  const viewAs = asParam && ADDRESS.test(asParam) ? asParam.toLowerCase() : null;
  const range = useRange(viewAs ?? connected);
  const sample = range.source === "sample";
  const now = useNow(5_000);
  const endpoints = hyperCoreEndpoints(mode);

  const agent = useAgentKey(mode, connected, now);
  const signer = useGuideSigner({ mode, connected, followed: range.address, sample, feeds: range.feeds, now });
  const overrides = useTradeStore((state) => state.overrides);
  const book = useMemo(() => effectiveRuleBook(overrides).book, [overrides]);
  const killSwitch = overrides.paused === true;

  const rules = useAlertStore((state) => state.rules);
  const standing = useMemo(() => rules.filter((rule) => rule.action), [rules]);
  const watch = useRuleWatch({ mode, ropes: range.ropes, fills: range.feeds.fills, now, live: !sample });

  const thread = useGuideStore((state) => state.thread);
  const audit = useGuideStore((state) => state.audit);
  const licenceDays = useGuideStore((state) => state.licenceDays);
  const streamId = useGuideStore((state) => state.streamId);
  const [signing, setSigning] = useState<{ readonly message: GuideMessage; readonly index: number; readonly proposal: Proposal } | null>(null);
  const [enableOpen, setEnableOpen] = useState(false);
  const composer = useRef<HTMLInputElement>(null);

  const facts = useMemo(
    () => buildFacts({ source: range.source, snapshot: range.snapshot, history: range.history, ropes: range.ropes, funding: signer.funding, ruleBook: bookSummary(book), killSwitch, now }),
    [range.source, range.snapshot, range.history, range.ropes, signer.funding, book, killSwitch, now],
  );
  const bulletin = useMemo(() => morningBulletin(facts, range.snapshot), [facts, range.snapshot]);

  const ask = useCallback(
    (question: string, options: { readonly silent?: boolean } = {}) => {
      const at = Date.now();
      const reply = answer(question, facts);
      const you: GuideMessage | null = options.silent ? null : { id: guideId("q", at), at, role: "you", text: question };
      const guide: GuideMessage = { id: guideId("g", at), at, role: "guide", text: question, reply, sample };
      useGuideStore.getState().ask(you, guide);
      const drafted = reply.proposals.filter((proposal) => proposal.kind === "anchor" || proposal.kind === "halve");
      if (drafted.length > 0 && !options.silent) {
        const first = drafted[0]!;
        useGuideStore.getState().log({ from: "GUIDE", to: "you", message: first.kind === "anchor" ? `drafted anchor ${first.coin} at ${px(first.stop)}${sample ? " (sample)" : ""}` : `drafted: halve ${first.coin}${sample ? " (sample)" : ""}`, tone: "plain" });
      }
    },
    [facts, sample],
  );

  // A standing order that fires while the Guide is open lands in the conversation as a draft to sign.
  const feed = useAlertStore((state) => state.feed);
  const heard = useRef<string | null>(null);
  useEffect(() => {
    const latest = feed[0];
    if (heard.current === null) {
      heard.current = latest?.id ?? "";
      return;
    }
    const fresh = [];
    for (const item of feed) {
      if (item.id === heard.current) break;
      if (item.action) fresh.push(item);
    }
    heard.current = latest?.id ?? heard.current;
    for (const item of fresh.reverse()) {
      const at = Date.now();
      const reply = standingReply({ event: item.message, action: item.action!, coin: item.coin ?? null }, facts);
      const guide: GuideMessage = { id: guideId("s", at), at, role: "guide", text: item.action!, reply, sample };
      useGuideStore.getState().ask(null, guide);
      useGuideStore.getState().log({ from: "GUIDE", to: "you", message: `standing order fired · drafted “${item.action}”${item.coin ? ` for ${item.coin}` : ""}`, tone: "alert" });
    }
  }, [feed, facts, sample]);

  // The Guide speaks first once a range is in: its read of the weakest rope.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !range.snapshot || useGuideStore.getState().thread.length > 0) return;
    if (!sample && !range.feeds.ready) return;
    opened.current = true;
    ask(OPENING, { silent: true });
  }, [range.snapshot, range.feeds.ready, sample, ask]);

  const pressKill = useCallback(() => {
    const store = useTradeStore.getState();
    store.setOverrides({ ...store.overrides, paused: true });
    const paused = useAlertStore.getState().pauseStanding();
    useGuideStore.getState().log({ from: "YOU", to: "GUIDE", message: `kill switch on · ${paused} standing order${paused === 1 ? "" : "s"} paused · nothing new signs`, tone: "alert" });
    toast.warning("Kill switch on", { description: "Nothing new signs. Closing and cancelling still work.", from: "BASE", id: "kill" });
  }, []);
  const releaseKill = useCallback(() => {
    const store = useTradeStore.getState();
    const { paused: _paused, ...rest } = store.overrides;
    store.setOverrides(rest);
    useGuideStore.getState().log({ from: "YOU", to: "GUIDE", message: "kill switch released · standing orders stay paused until you arm them", tone: "plain" });
  }, []);

  // Keys: A focuses the question, Shift+K presses the kill switch.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      if (event.key === "a" && !event.shiftKey) {
        event.preventDefault();
        composer.current?.focus();
      } else if (event.key === "K" && event.shiftKey && !useTradeStore.getState().overrides.paused) {
        event.preventDefault();
        pressKill();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pressKill]);

  const act = useCallback(
    (message: GuideMessage, index: number, proposal: Proposal) => {
      const store = useGuideStore.getState();
      if (proposal.kind === "route") {
        store.setOutcome(message.id, index, "opened", "route card opened on the deck");
        navigate(intentHref(proposal.sentence));
        return;
      }
      if (proposal.kind === "rule") {
        const at = Date.now();
        useAlertStore.getState().addRule({ ...proposal.parsed.rule, id: newRuleId(at), createdAt: at, lastFiredAt: null, armed: true, once: false, channels: { app: true, telegram: false } });
        store.setOutcome(message.id, index, "armed", proposal.parsed.rule.action ? "standing order pinned · drafts only" : "alert armed · in-app feed");
        store.log({ from: "YOU", to: "GUIDE", message: `${proposal.parsed.rule.action ? "standing order" : "alert"} armed: ${proposal.parsed.understood}`, tone: "settled" });
        return;
      }
      setSigning({ message, index, proposal });
    },
    [],
  );

  const onResult = useCallback(
    (result: SubmitResult, plan: TradePlan) => {
      if (!signing) return;
      const store = useGuideStore.getState();
      if (result.ok) {
        store.setOutcome(signing.message.id, signing.index, "signed", `${plan.label} · placed on the Floor`);
        store.log({ from: "FLOOR", to: "you", message: `${plan.label} · you signed`, tone: "settled" });
        toast.success(plan.label, { description: "Signed by your trade-only key · placed on HyperCore.", from: "FLOOR" });
      } else if (result.kind === "blocked") {
        store.setOutcome(signing.message.id, signing.index, "blocked", result.message);
        store.log({ from: "RULES", to: "GUIDE", message: `refused: ${result.message}`, tone: "refused" });
      } else if (result.kind !== "confirm") {
        store.setOutcome(signing.message.id, signing.index, "refused", result.message);
        store.log({ from: "FLOOR", to: "you", message: `refused: ${result.message}`, tone: "refused" });
      }
    },
    [signing],
  );

  const history = useMemo(() => thread.filter((message) => message.role === "you").map((message) => message.text), [thread]);
  const holder = range.address ?? connected ?? SAMPLE_ADDRESS;
  const unlocked = agent.session.phase === "ready";

  return (
    <Page className="pb-16">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-5 sm:mb-8">
        <div className="min-w-0 max-w-3xl">
          <p className="label-tab mb-4">Sheet 05 · The Guide · reads the range · drafts · you sign</p>
          <h1 className="text-[44px] font-bold leading-[1] tracking-[-0.03em] text-ink sm:text-[64px]">Ask the Guide.</h1>
          <p className="mt-3 max-w-2xl text-[17px] leading-relaxed text-ink-2 text-pretty sm:text-[19px]">
            It reads your ropes, exposure and funding, says what it would do and drafts the move. <span className="font-semibold text-ink">You sign every one; it can never withdraw.</span>
          </p>
        </div>
        <dl className="grid min-w-[280px] grid-cols-[auto_minmax(0,1fr)] border-2 border-rule bg-card font-mono text-[12px] shadow-hard" aria-label="How the Guide may act">
          <dt className="border-b-1.5 border-rule/30 bg-paper-2 px-3 py-1.5 font-semibold uppercase tracking-[0.1em] text-ink">Propose</dt>
          <dd className="border-b-1.5 border-rule/30 px-3 py-1.5 text-ink-2">
            <span className="text-up">● on</span> · default · you sign
          </dd>
          <dt className="border-b-1.5 border-rule/30 bg-paper-2 px-3 py-1.5 font-semibold uppercase tracking-[0.1em] text-ink">Autopilot</dt>
          <dd className="border-b-1.5 border-rule/30 px-3 py-1.5 text-ink-2">{unlocked ? <span className="text-up">● key unlocked</span> : <span>○ key {agent.session.phase === "locked" ? "locked" : "off"}</span>} · this tab</dd>
          <dt className="bg-paper-2 px-3 py-1.5 font-semibold uppercase tracking-[0.1em] text-ink">Keeper</dt>
          <dd className="px-3 py-1.5 text-ink-2">○ opt-in · coming online</dd>
        </dl>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.62fr)_minmax(340px,1fr)] xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <MorningBulletin columns={bulletin} now={now} sample={sample} onAsk={(question) => ask(question)} />
          <section className="flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard-lg" aria-label="Conversation with the Guide">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-rule px-4 py-2">
              <h2 className="caption !text-ink">Radio · you ↔ the Guide · local planner</h2>
              <p className="flex items-center gap-3 font-mono text-[11px] text-ink-2">
                <span className={cx("flex items-center gap-1.5 uppercase tracking-[0.1em]", sample && "text-ink")}>
                  <span aria-hidden="true" className={cx("h-2 w-2 rotate-45", sample ? "bg-signal outline outline-1 outline-rule" : "bg-up")} />
                  {SOURCE_WORD[range.source]}
                  {range.address && !sample ? ` · ${shortAddr(range.address)}` : ""}
                </span>
                {thread.length > 0 ? (
                  <button type="button" onClick={() => useGuideStore.getState().clearThread()} className="underline decoration-dotted underline-offset-2 hover:text-ink">
                    clear
                  </button>
                ) : null}
              </p>
            </header>
            <div data-guide-scroll className="max-h-[min(70vh,720px)] min-h-[320px] overflow-y-auto px-4 py-5 sm:px-6">
              {thread.length === 0 ? (
                <p className="font-mono text-[13px] text-ink-3" aria-busy={range.snapshot === null}>
                  {range.snapshot ? "The Guide is reading your range…" : "Surveying the range…"}
                </p>
              ) : (
                <Conversation thread={thread} streamId={streamId} onAct={act} onAsk={(question) => ask(question)} sample={sample} />
              )}
            </div>
            <div className="border-t-2 border-rule bg-paper-2/60 px-4 py-3 sm:px-5">
              <Composer ref={composer} onAsk={(question) => ask(question)} starters={STARTERS.slice(1)} history={history} busy={false} />
            </div>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="The Guide's licence, orders and log">
          <KillSwitch on={killSwitch} onPress={pressKill} onRelease={releaseKill} />
          <LicenceCard holder={holder} book={book} days={licenceDays} onDays={(days) => useGuideStore.getState().setLicenceDays(days)} now={now} sample={sample} keeperOnline={false} />
          <StandingOrders
            rules={standing}
            statuses={watch.statuses}
            onToggle={(rule) => {
              if (!rule.armed && killSwitch) {
                toast.warning("The kill switch is on", { description: "Release it first; standing orders stay paused while it is on.", from: "BASE" });
                return;
              }
              useAlertStore.getState().updateRule(rule.id, { armed: !rule.armed });
              useGuideStore.getState().log({ from: "YOU", to: "GUIDE", message: `${rule.armed ? "paused" : "armed"}: ${rule.action}`, tone: "plain" });
            }}
            onRemove={(rule) => {
              useAlertStore.getState().removeRule(rule.id);
              useGuideStore.getState().log({ from: "YOU", to: "GUIDE", message: `deleted standing order: ${rule.action}`, tone: "plain" });
            }}
            onAsk={(question) => ask(question)}
          />
          <AuditLog entries={audit} />
        </aside>
      </div>

      <SignDialog
        open={signing !== null}
        proposal={signing?.proposal ?? null}
        signer={signer}
        onClose={() => setSigning(null)}
        onEnable={() => setEnableOpen(true)}
        onUnlock={() => agent.unlock()}
        onResult={onResult}
      />
      <EnableTradingDialog open={enableOpen} onClose={() => setEnableOpen(false)} api={agent} hyperliquidChain={endpoints.hyperliquidChain} />
    </Page>
  );
}
