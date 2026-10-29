import React, { useEffect, useMemo, useRef, useState } from "react";

import { useReducedMotion } from "../../../motion/useReducedMotion";
import { HutStamp } from "../../../topo/HutStamp";
import { Rope } from "../../../topo/Rope";
import { Button } from "../../../ui/Button";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { ruleCondition } from "../../alerts/model/rules";
import { useGuideStore, type GuideMessage, type ProposalOutcome } from "../guide/guideStore";
import { pct, px, usd, type Proposal, type Reading, type Segment } from "../guide/planner";
import { RouteProposal } from "./RouteProposal";

export interface ConversationProps {
  readonly thread: readonly GuideMessage[];
  /** The newest Guide message streams in; older ones render whole. */
  readonly streamId: string | null;
  readonly onAct: (message: GuideMessage, index: number, proposal: Proposal) => void;
  readonly onAsk: (question: string) => void;
  readonly sample: boolean;
}

const TONE: Readonly<Record<NonNullable<Segment["tone"]>, string>> = {
  plain: "",
  strong: "font-semibold text-ink",
  up: "font-semibold text-up",
  down: "font-semibold text-down",
};

const OUTCOME_WORD: Readonly<Record<ProposalOutcome, string>> = { signed: "Settled", refused: "Refused", armed: "Armed", opened: "Opened", blocked: "Held" };

function clock(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Scrolls the log so a turn's top sits at the top of the view (or shows it whole when it fits). */
function showTurn(turn: HTMLElement | null): void {
  const box = turn?.closest<HTMLElement>("[data-guide-scroll]");
  if (!turn || !box) return;
  const top = turn.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
  const fits = turn.offsetHeight + 32 <= box.clientHeight;
  box.scrollTop = fits ? box.scrollHeight - box.clientHeight : top;
}

/** Words of the reply, revealed ~45 per second; reduced motion shows them at once. */
function useStream(total: number, active: boolean): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const live = active && !reduced;
  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => {
      setShown((previous) => {
        if (previous >= total) {
          window.clearInterval(timer);
          return previous;
        }
        return previous + 2;
      });
    }, 44);
    return () => window.clearInterval(timer);
  }, [live, total]);
  return live ? Math.min(shown, total) : total;
}

/** The Guide's call sign: a small square plate. */
function GuidePlate() {
  return (
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-rule bg-signal font-mono text-[13px] font-bold text-signal-ink shadow-hard">
      G
    </span>
  );
}

function StreamedText({ segments, active, onDone }: { readonly segments: readonly Segment[]; readonly active: boolean; readonly onDone: () => void }) {
  const words = useMemo(() => segments.flatMap((segment, index) => segment.text.split(/(?<=\s)/u).map((word) => ({ word, index }))), [segments]);
  const shown = useStream(words.length, active);
  const done = shown >= words.length;
  useEffect(() => {
    if (done) onDone();
  }, [done, onDone]);
  const visible = words.slice(0, shown);
  return (
    <p className="max-w-[68ch] text-[16px] leading-relaxed text-ink-2 sm:text-[17px]">
      <span className="sr-only">{segments.map((segment) => segment.text).join("")}</span>
      <span aria-hidden="true">
        {visible.map((entry, position) => (
          <span key={position} className={TONE[segments[entry.index]?.tone ?? "plain"]}>
            {entry.word}
          </span>
        ))}
        {!done ? <span className="ml-0.5 inline-block h-[1em] w-[0.5ch] translate-y-[0.15em] bg-ink/70" /> : null}
      </span>
    </p>
  );
}

function Readings({ readings, animate }: { readonly readings: readonly Reading[]; readonly animate: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Survey readings the Guide took">
      {readings.map((reading, index) => (
        <li
          key={reading.label}
          className={cx("border-1.5 border-dashed border-rule/60 bg-paper px-2 py-0.5 font-mono text-[11px] text-ink-2", animate && "el-rise")}
          style={animate ? { animationDelay: `${index * 90}ms` } : undefined}
        >
          <span className="text-up" aria-hidden="true">
            ✓
          </span>{" "}
          {reading.label} · <span className="text-ink">{reading.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function Outcome({ outcome, layer }: { readonly outcome: NonNullable<GuideMessage["outcomes"]>[number]; readonly layer: "floor" }) {
  const good = outcome.status === "signed" || outcome.status === "armed" || outcome.status === "opened";
  return (
    <div className={cx("el-rise flex items-center gap-3 border-2 px-3 py-2", good ? "border-up/70 bg-card" : "border-down/70 bg-card")}>
      {outcome.status === "signed" ? <HutStamp layer={layer} state="signed" size={46} animate time={clock(outcome.at).slice(0, 5)} label={null} /> : null}
      <p className="font-mono text-[12px] leading-snug text-ink-2">
        <span className={cx("font-semibold uppercase tracking-[0.1em]", good ? "text-up" : "text-down")}>
          {good ? "◎" : "✕"} {OUTCOME_WORD[outcome.status]}
        </span>{" "}
        · {outcome.note} · {clock(outcome.at)}
      </p>
    </div>
  );
}

function AnchorProposal({ proposal, onSet, onHalve, sample, done }: { readonly proposal: Extract<Proposal, { kind: "anchor" }>; readonly onSet: () => void; readonly onHalve: (() => void) | null; readonly sample: boolean; readonly done: boolean }) {
  const ropeNow = proposal.liquidation !== null ? Math.abs(proposal.mark - proposal.liquidation) / proposal.mark : null;
  return (
    <div className="el-rise border-2 border-rule bg-card shadow-hard">
      <p className="flex flex-wrap items-center justify-between gap-2 border-b-1.5 border-dashed border-rule/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
        <span className="text-ink">
          Proposal · anchor {proposal.coin} {proposal.side}
          {sample ? " · sample" : ""}
        </span>
        <span>
          rope today {ropeNow === null ? "—" : pct(ropeNow, 1)} · with the anchor the fall stops at {pct(proposal.stopDistance, 1)}
        </span>
      </p>
      <div className="px-3 pb-1 pt-3">
        <div className="hidden sm:block">
          <Rope variant="full" symbol={proposal.coin} side={proposal.side} entry={proposal.entry} mark={proposal.mark} liquidation={proposal.liquidation} stop={proposal.stop} takeProfit={proposal.takeProfit} formatPrice={px} />
        </div>
        <div className="sm:hidden">
          <Rope variant="compact" symbol={proposal.coin} side={proposal.side} entry={proposal.entry} mark={proposal.mark} liquidation={proposal.liquidation} stop={proposal.stop} takeProfit={proposal.takeProfit} formatPrice={px} />
        </div>
      </div>
      <p className="px-3 font-mono text-[11px] text-ink-3">
        ⚓ new anchor {px(proposal.stop)} · {usd(-proposal.maxLoss)} max from here{proposal.currentStop !== null ? ` · replaces ${px(proposal.currentStop)}` : ""}
        {proposal.liquidation !== null ? ` · ✕ crevasse ${px(proposal.liquidation)}` : ""}
      </p>
      {!done ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-3">
          <Button variant="primary" size="md" grade={1} onClick={onSet} className="w-full sm:w-auto">
            Set anchor {px(proposal.stop)} · reduce-only ▸
          </Button>
          {onHalve ? (
            <Button variant="ink" size="md" onClick={onHalve} className="w-full sm:w-auto">
              Halve it · {px(proposal.size / 2)} {proposal.coin} ▸
            </Button>
          ) : null}
          <span className="font-mono text-[11px] text-ink-3">{sample ? "sample · connect to sign your own" : "review first · your trading key signs · never withdraws"}</span>
        </div>
      ) : null}
    </div>
  );
}

function RuleProposal({ proposal, onArm, done }: { readonly proposal: Extract<Proposal, { kind: "rule" }>; readonly onArm: () => void; readonly done: boolean }) {
  const rule = proposal.parsed.rule;
  const condition = ruleCondition({ ...rule, id: "draft", createdAt: 0, lastFiredAt: null, armed: false, once: false, channels: { app: true, telegram: false } });
  return (
    <div className="el-rise border-2 border-rule bg-card shadow-hard">
      <p className="border-b-1.5 border-dashed border-rule/60 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">{rule.action ? "Standing order · draft" : "Alert · draft"}</p>
      <div className="grid gap-2 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">When</span>
        <span className="text-[16px] font-semibold text-ink">{condition}</span>
        {rule.action ? (
          <>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Draft</span>
            <span className="font-mono text-[14px] text-ink">“{rule.action}” · you sign</span>
          </>
        ) : (
          <>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Tell</span>
            <span className="text-[14px] text-ink-2">the feed here · Telegram once linked</span>
          </>
        )}
      </div>
      {!done ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <Button variant="primary" size="md" onClick={onArm}>
            {rule.action ? "Pin as standing order" : "Arm the alert"}
          </Button>
          <span className="font-mono text-[11px] text-ink-3">watched in this tab · nothing signs on its own</span>
        </div>
      ) : null}
    </div>
  );
}

function GuideTurn({ message, streaming, onAct, onAsk, sample }: { readonly message: GuideMessage; readonly streaming: boolean; readonly onAct: ConversationProps["onAct"]; readonly onAsk: (q: string) => void; readonly sample: boolean }) {
  const reply = message.reply!;
  const [settled, setSettled] = useState(!streaming);
  const markDone = React.useCallback(() => {
    setSettled(true);
    // Streamed once: a later visit shows it whole.
    if (useGuideStore.getState().streamId === message.id) useGuideStore.setState({ streamId: null });
  }, [message.id]);
  const outcomes = message.outcomes ?? {};
  const halveIndex = reply.proposals.findIndex((proposal) => proposal.kind === "halve");
  const self = useRef<HTMLLIElement>(null);
  // Once the streamed answer and its proposals are in, keep them in view inside the log.
  const streamed = useRef(streaming);
  useEffect(() => {
    if (!settled || !streamed.current) return;
    streamed.current = false;
    showTurn(self.current);
  }, [settled]);
  return (
    <li ref={self} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <GuidePlate />
      <div className="flex min-w-0 flex-col gap-3">
        <Readings readings={reply.readings} animate={streaming} />
        <StreamedText segments={reply.segments} active={streaming} onDone={markDone} />
        {settled
          ? reply.proposals.map((proposal, index) => {
              const outcome = outcomes[index];
              if (proposal.kind === "halve" && halveIndex === index && reply.proposals.some((entry) => entry.kind === "anchor")) {
                return outcome ? <Outcome key={index} outcome={outcome} layer="floor" /> : null;
              }
              return (
                <React.Fragment key={index}>
                  {proposal.kind === "anchor" ? (
                    <AnchorProposal proposal={proposal} sample={sample} done={Boolean(outcome) || Boolean(outcomes[halveIndex])} onSet={() => onAct(message, index, proposal)} onHalve={halveIndex >= 0 ? () => onAct(message, halveIndex, reply.proposals[halveIndex]!) : null} />
                  ) : proposal.kind === "halve" ? (
                    !outcome ? (
                      <div className="el-rise flex flex-wrap items-center gap-2">
                        <Button variant="primary" size="md" onClick={() => onAct(message, index, proposal)}>
                          {(proposal.fraction ?? 0.5) === 1 ? `Close ${px(proposal.size)} ${proposal.coin}` : `Halve ${proposal.coin} · ${px(proposal.size / 2)} of ${px(proposal.size)}`} reduce-only ▸
                        </Button>
                        <span className="font-mono text-[11px] text-ink-3">review first · you sign</span>
                      </div>
                    ) : null
                  ) : proposal.kind === "route" ? (
                    <RouteProposal sentence={proposal.sentence} onOpen={() => onAct(message, index, proposal)} />
                  ) : (
                    <RuleProposal proposal={proposal} done={Boolean(outcome)} onArm={() => onAct(message, index, proposal)} />
                  )}
                  {outcome ? <Outcome outcome={outcome} layer="floor" /> : null}
                </React.Fragment>
              );
            })
          : null}
        {settled && reply.followUps.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-ink-3">
            <span>or ask</span>
            {reply.followUps.map((question) => (
              <button key={question} type="button" onClick={() => onAsk(question)} className={cx("text-ink-2 underline decoration-dotted underline-offset-[3px] hover:text-ink", FOCUS_RING)}>
                “{question}”
              </button>
            ))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The Guide's conversation: your questions, the readings it took, its answer and the proposals you sign. */
export function Conversation({ thread, streamId, onAct, onAsk, sample }: ConversationProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = thread[thread.length - 1]?.id;
  // Keep the newest turn in view inside the scrolling log (never scroll the page itself).
  useEffect(() => {
    if (!last) return;
    const turns = endRef.current?.parentElement?.children;
    const newest = turns && turns.length >= 2 ? (turns[turns.length - 2] as HTMLElement) : null;
    showTurn(newest);
  }, [last]);
  return (
    <ol className="flex flex-col gap-6" aria-live="polite" aria-relevant="additions">
      {thread.map((message) =>
        message.role === "you" ? (
          <li key={message.id} className="el-rise flex justify-end">
            <p className="max-w-[85%] border-2 border-rule bg-card px-4 py-2.5 text-[15px] text-ink shadow-hard sm:text-[16px]">
              {message.text}
              <span className="sr-only"> (you asked at {clock(message.at)})</span>
            </p>
          </li>
        ) : (
          <GuideTurn key={message.id} message={message} streaming={message.id === streamId} onAct={onAct} onAsk={onAsk} sample={sample || message.sample === true} />
        ),
      )}
      <div ref={endRef} aria-hidden="true" />
    </ol>
  );
}
