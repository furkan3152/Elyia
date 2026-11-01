import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useSearchParam } from "../../app/routes/useRoute";
import { Cards, Page, Section, Split } from "../../pixel/layout";
import { useUiStore } from "../../app/state/uiStore";
import { EnableTradingDialog } from "../../features/agentKey/EnableTradingDialog";
import { useAgentKey } from "../../features/agentKey/useAgentKey";
import type { SubmitResult, TradePlan } from "../../features/trading/executor";
import { bookSummary, effectiveRuleBook } from "../../features/trading/guard";
import { useTradeStore } from "../../features/trading/tradeStore";
import { useNow } from "../../hooks/useNow";
import { hyperCoreEndpoints } from "../../lib/hypercore/endpoints";
import { intentHref } from "../../oracle/preview";
import { cx, FOCUS_RING } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { useAlertStore } from "../alerts/model/alertStore";
import { newRuleId } from "../alerts/model/rules";
import { useRuleWatch } from "../alerts/model/useRuleWatch";
import { shortAddr } from "../portfolio/range/format";
import { SAMPLE_ADDRESS } from "../portfolio/range/sample";
import { useRange } from "../portfolio/range/useRange";
import { buildFacts, guideRopes, morningBulletin } from "./guide/facts";
import { guideId, useGuideStore, type GuideMessage } from "./guide/guideStore";
import { elyMood } from "./guide/mood";
import { answer, px, standingReply, STARTERS, type Proposal } from "./guide/planner";
import { useGuideSigner } from "./guide/useGuideSigner";
import { Composer } from "./parts/Composer";
import { Conversation } from "./parts/Conversation";
import { GuideStage } from "./parts/GuideStage";
import { AuditLog, KillNote, KillSwitch, LicenceCard, MorningBulletin, StandingOrders } from "./parts/Instruments";
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
 * Ely sits across the survey table at the top (its state says the state of
 * the range and the talk); below: the morning bulletin, the big kill switch,
 * the keeper licence (opt-in, draft until the keeper is online) with the
 * standing orders, and the audit radio log. One centre axis throughout.
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
      const reply = answer(question, facts);
      // The local Guide reads a few English phrasings only. Anything it cannot place (Turkish, free-form
      // questions, multi-step moves) goes to Ask Ely, which runs the real agent in either language.
      if (reply.topic === "help" && !options.silent && question.trim().length > 0) {
        navigate(`${routeHref("deck")}?intent=${encodeURIComponent(question.trim())}`);
        return;
      }
      const at = Date.now();
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

  // Ely's mood: the latest win (a signature or an armed rule) puts the crown on for a moment.
  const lastWin = useMemo(() => {
    let latest: number | null = null;
    for (const message of thread) for (const outcome of Object.values(message.outcomes ?? {})) if (outcome.status === "signed" || outcome.status === "armed") latest = Math.max(latest ?? 0, outcome.at);
    return latest;
  }, [thread]);
  const mood = useMemo(
    () => elyMood({ surveying: range.snapshot === null || (!sample && !range.feeds.ready), speaking: streamId !== null, killSwitch, ropes: guideRopes(range.ropes), lastWin, now, sample }),
    [range.snapshot, range.feeds.ready, sample, streamId, killSwitch, range.ropes, lastWin, now],
  );

  // One-tap questions from the sections below bring the table back into view.
  const table = useRef<HTMLDivElement>(null);
  const askFromBelow = useCallback(
    (question: string) => {
      ask(question);
      table.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    },
    [ask],
  );

  const modes: readonly { readonly key: string; readonly label: string; readonly value: string; readonly on: boolean }[] = [
    { key: "propose", label: "Propose", value: "on · you sign", on: true },
    { key: "autopilot", label: "Autopilot", value: unlocked ? "key unlocked" : `key ${agent.session.phase === "locked" ? "locked" : "off"}`, on: unlocked },
    { key: "keeper", label: "Keeper", value: "opt-in · coming online", on: false },
    { key: "kill", label: "Kill switch", value: killSwitch ? "on · nothing signs" : "off · ⇧K", on: killSwitch },
  ];

  return (
    <Page className="!pt-0">
      <Section
        level={1}
        tag="Sheet 05 · The Guide · reads the range · drafts · you sign"
        title="Talk to Ely."
        lede={
          <>
            Ely reads your ropes, exposure and funding, says what it would do and drafts the move. <span className="font-semibold text-ink">You sign every one; Ely can never withdraw.</span>
          </>
        }
        actions={
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4" aria-label="How Ely may act">
            {modes.map((entry) => (
              <div key={entry.key} className={cx("flex min-w-[9.5rem] flex-col items-center gap-0.5 px-3 py-2 px-frame-thin", entry.key === "kill" && entry.on ? "bg-down text-card" : "bg-card")}>
                <dt className={cx("flex items-center gap-1.5 font-tag text-[11px] uppercase", entry.key === "kill" && entry.on ? "text-card" : "text-ink")}>
                  <span aria-hidden="true" className={cx("inline-block h-2 w-2", entry.on ? (entry.key === "kill" ? "bg-card" : "bg-up") : "bg-ink-3/40")} />
                  {entry.label}
                </dt>
                <dd className={cx("font-mono text-[11px]", entry.key === "kill" && entry.on ? "text-card" : "text-ink-2")}>
                  {entry.key === "kill" ? (
                    <a href="#kill" className={cx("underline decoration-dotted underline-offset-2", FOCUS_RING)}>
                      {entry.value}
                    </a>
                  ) : (
                    entry.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        }
      >
        <div ref={table} className="scroll-mt-28">
          <section className="flex min-w-0 flex-col overflow-hidden bg-card px-frame px-drop-lg" aria-label="Conversation with Ely, the Guide">
            <GuideStage mood={mood} />
            <header className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b-2 border-dashed border-rule px-4 py-2 text-center">
              <span className={cx("flex items-center gap-1.5 font-tag text-[11px] uppercase", sample ? "text-ink" : "text-up")}>
                <span aria-hidden="true" className={cx("inline-block h-2 w-2", sample ? "bg-signal" : "bg-up")} />
                {SOURCE_WORD[range.source]}
                {range.address && !sample ? ` · ${shortAddr(range.address)}` : ""}
              </span>
              <span className="hidden font-tag text-[11px] uppercase text-ink-3 sm:inline">local planner · every number from your range</span>
              {thread.length > 0 ? (
                <button type="button" onClick={() => useGuideStore.getState().clearThread()} className={cx("font-tag text-[11px] uppercase text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink", FOCUS_RING)}>
                  clear the table
                </button>
              ) : null}
            </header>
            <div data-guide-scroll className="max-h-[min(64vh,640px)] min-h-[300px] overflow-y-auto px-5 py-8 sm:px-8">
              <div className="mx-auto max-w-[880px]">
                {thread.length === 0 ? (
                  <p className="text-center font-tag text-[12px] uppercase text-ink-3" aria-busy={range.snapshot === null}>
                    {range.snapshot ? "Ely is reading your range…" : "Surveying the range…"}
                  </p>
                ) : (
                  <Conversation thread={thread} streamId={streamId} onAct={act} onAsk={(question) => ask(question)} sample={sample} />
                )}
              </div>
            </div>
            <div className="border-t-2 border-rule bg-paper-2 px-4 pb-6 pt-5 sm:px-8">
              <div className="mx-auto max-w-[880px]">
                <Composer ref={composer} onAsk={(question) => ask(question)} starters={STARTERS.slice(1)} history={history} busy={false} />
              </div>
            </div>
          </section>
        </div>
      </Section>

      <Section id="bulletin" tag="07:00 · Morning bulletin · Telegram once linked" title="What Ely saw overnight." lede="Overnight, on the summit and today: the same readings, every morning. One tap asks Ely what to do about it.">
        <MorningBulletin columns={bulletin} now={now} sample={sample} onAsk={askFromBelow} />
      </Section>

      <Section id="kill" tag="Kill switch · ⇧K anywhere on this sheet" title="One press, everything holds." lede="The switch stops every standing order and every new signature at once. It never traps you: closing and cancelling always work.">
        <Cards n={3}>
          <div className="order-2 min-[900px]:order-none">
            <KillNote side="stops" on={killSwitch} />
          </div>
          <div className="order-first min-[900px]:order-none">
            <KillSwitch on={killSwitch} onPress={pressKill} onRelease={releaseKill} />
          </div>
          <div className="order-3 min-[900px]:order-none">
            <KillNote side="works" on={killSwitch} />
          </div>
        </Cards>
      </Section>

      <Section id="licence" tag="Keeper mode · optional · a permit with punched days" title="Ely's licence." lede="If you ever let Ely act while you sleep, it carries a permit: your Rule Book's limits, the days it is valid, trade only. Until the keeper is online it stays a draft.">
        <Split>
          <LicenceCard holder={holder} book={book} days={licenceDays} onDays={(days) => useGuideStore.getState().setLicenceDays(days)} now={now} sample={sample} keeperOnline={false} />
          <StandingOrders
            className="h-full"
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
            onAsk={askFromBelow}
          />
        </Split>
      </Section>

      <Section id="audit" tag="Audit · every move · this device" title="The radio log." lede="Every proposal, signature, refusal and kill-switch press, in order. Kept in this browser.">
        <div className="mx-auto max-w-[880px]">
          <AuditLog entries={audit} />
        </div>
      </Section>

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
