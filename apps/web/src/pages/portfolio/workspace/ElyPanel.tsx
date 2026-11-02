import type { Insight } from "@elyia/core/api/agent";
import { useMemo, useState } from "react";

import { Link } from "../../../app/routes/Link";
import { routeHref } from "../../../app/routes/routeTable";
import { Composer } from "../../../features/ely/Composer";
import { useStickToBottom } from "../../../features/ely/hooks";
import { ElyMessage, UserMessage } from "../../../features/ely/Messages";
import { RouteArtifact } from "../../../features/ely/RouteArtifact";
import { signSourceOf } from "../../../features/ely/signSource";
import { primaryCard, type ElyTurn, type Turn } from "../../../features/ely/turn";
import { ElyAvatar, Glyph } from "../../../features/ely/ui";
import { useHerdAvatar } from "../../../features/herd/useHerdAvatar";
import { HerdPortrait } from "../../../pixel/Herd";
import type { WalletSession } from "../../../features/session/useWalletSession";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Sheet } from "../../../ui/Sheet";
import { shortAddr } from "../range/format";
import { insightViews } from "../v2/model";
import { Automations } from "./Automations";
import { EXPLAIN_PNL } from "./model";
import { PnlCard } from "./PnlCard";
import type { SignRequest } from "./SignDialog";
import type { PortfolioChat } from "./usePortfolioChat";

const FOLLOW_UPS = [EXPLAIN_PNL, "Protect my positions", "What if HYPE drops 20%?", "What's my HYPE exposure?"] as const;

export interface ElyPanelProps {
  readonly insights: readonly Insight[];
  readonly insightsSample: boolean;
  readonly insightsLoading: boolean;
  readonly insightsError: string | null;
  readonly chat: PortfolioChat;
  /** 30-day explain-PnL figures for the waterfall artifact. */
  readonly pnl: Readonly<Record<string, string | number | null>> | null;
  readonly pnlSample: boolean;
  /** The wallet the conversation reads (null: the labelled sample range). */
  readonly followed: string | null;
  /** What the chat reads for the sample: the example testnet wallet. */
  readonly chatAddress: string;
  readonly session: WalletSession;
  readonly token: string | null;
  readonly own: boolean;
  readonly phone: boolean;
  readonly automationsOpen: boolean;
  readonly onAutomationsOpen: (open: boolean) => void;
  readonly onDraft: (request: SignRequest) => void;
}

/**
 * Ely, docked: one panel that owns everything Ely does on this portfolio.
 * Its first message is what Ely noticed (compact rows, each one tap from the
 * real sign flow, plus "Why?"); then the conversation about this range on
 * the real chat stream ("Explain my PnL" answers with the waterfall as an
 * inline artifact); the composer; automations in one line that opens into
 * switches and Autopilot's caps; and the trust line. Nothing here signs.
 */
export function ElyPanel({ insights, insightsSample, insightsLoading, insightsError, chat, pnl, pnlSample, followed, chatAddress, session, token, own, phone, automationsOpen, onAutomationsOpen, onDraft }: ElyPanelProps) {
  const herdAvatar = useHerdAvatar(session.address);
  const views = useMemo(() => insightViews(insights).slice(0, 5), [insights]);
  const [why, setWhy] = useState<string | null>(null);
  const [cardTurn, setCardTurn] = useState<string | null>(null);
  const { scroller, content } = useStickToBottom(chat.turns.length, { topWhenEmpty: true });
  const sample = followed === null;
  const count = views.length;
  const status = insightsLoading ? "reading your range" : count === 0 ? "all quiet" : `noticed ${count} thing${count === 1 ? "" : "s"}`;

  const opened = cardTurn ? (chat.turns.find((turn): turn is ElyTurn => turn.kind === "ely" && turn.id === cardTurn) ?? null) : null;
  const openedPrimary = opened ? primaryCard(opened) : null;

  return (
    <aside className="ely-panel" aria-label="Ely">
      <header className="ep-h">
        <div className="min-w-0 flex-1">
          <h2 className="disp flex items-center gap-2 text-[17px] leading-tight">
            Ely <span className="pill acc">Propose · you sign</span>
          </h2>
          <p className="t-tag t-faint truncate !text-[9px]">{sample ? "watching the labelled sample" : `watching ${shortAddr(followed)}`}</p>
        </div>
        <Link to={`${routeHref("deck")}${sample ? "" : `?as=${followed}`}`} className={cx("b xs", FOCUS_RING)} title="Open Ask Ely with this wallet">
          Open in Ask Ely ▸
        </Link>
      </header>
      <Automations session={session} own={own} sample={sample} open={automationsOpen} onToggleOpen={() => onAutomationsOpen(!automationsOpen)} />
      <div ref={scroller} className="ep-scroll">
        <div ref={content} className="ep-thread">
          <div className="msg-e">
            {herdAvatar ? (
              <span className="inline-block h-[44px] w-[44px] shrink-0">
                <HerdPortrait id={herdAvatar.art} fluid label={`Your Ely, Herd goat${herdAvatar.tokenId ? ` #${herdAvatar.tokenId}` : ""}: ${status}`} />
              </span>
            ) : (
              <ElyAvatar state={insightsLoading ? "climb" : views.some((view) => view.severity === "act") ? "worry" : "idle"} label={`Ely: ${status}`} />
            )}
            <div className="bd">
              <div className="who">
                <b>Ely</b> · <span>{status}</span>
                {insightsSample ? <span className="pill sig">sample</span> : null}
              </div>
              {insightsError ? <p className="note">The insights did not load ({insightsError}). The range is still live.</p> : null}
              {count === 0 && !insightsLoading ? <p>No rope near the edge, no idle cash past your floor, no drift beyond your band. I keep watching.</p> : null}
              {count > 0 ? (
                <ul className="notice" aria-label="Ely noticed">
                  {views.map((view) => {
                    const insight = insights.find((entry) => entry.id === view.id)!;
                    const open = why === view.id;
                    return (
                      <li key={view.id} className={cx("nrow", view.severity === "act" && "act")}>
                        <span className="ic" aria-hidden="true">
                          <Glyph name={view.glyph} scale={2} />
                        </span>
                        <span className="tx">
                          <b>{view.title}</b>
                          <span className={cx("body", open && "open")}>{view.body}</span>
                          {open ? (
                            <dl className="figs">
                              {view.figures.map((figure) => (
                                <div key={figure.key} className="contents">
                                  <dt>{figure.key}</dt>
                                  <dd className="num">{figure.value}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                          <span className="meta">
                            <span className={cx("pill", view.severity === "act" ? "dn" : view.severity === "watch" ? "sig" : "mute")}>{view.severityWord}</span>
                            {view.layer ? <span className="pill mute">{view.layer}</span> : null}
                            {view.paper ? <span className="pill sig">paper · testnet</span> : null}
                            <button type="button" className={cx("why", FOCUS_RING)} aria-expanded={open} onClick={() => setWhy((current) => (current === view.id ? null : view.id))}>
                              {open ? "Hide" : "Why?"}
                            </button>
                            {view.action ? (
                              <button type="button" className={cx("b xs ml-auto", view.severity === "act" && "dn", FOCUS_RING)} onClick={() => onDraft({ title: view.title, source: { kind: "actions", actions: insight.actions, sentence: view.title } })} aria-label={`${view.action}: opens the sign flow for “${view.title}”`}>
                                {view.action}
                              </button>
                            ) : (
                              <button type="button" className={cx("b xs ml-auto", FOCUS_RING)} onClick={() => chat.send(view.title)} aria-label={`Ask Ely about “${view.title}”`}>
                                Ask
                              </button>
                            )}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <p className="t-tag t-faint !text-[9px]">Each one is a draft · one tap opens it in your wallet · nothing moves until you sign</p>
            </div>
          </div>
          {chat.turns.map((turn: Turn) =>
            turn.kind === "user" ? (
              <UserMessage key={turn.id} text={turn.text} />
            ) : (
              <div key={turn.id} className="flex flex-col gap-3">
                <ElyMessage
                  turn={turn}
                  phone={true}
                  opened={cardTurn === turn.id}
                  onOpenCard={() => setCardTurn(turn.id)}
                  onAnswer={(questionId, value) => chat.answer(turn.id, questionId, value)}
                  signInHint={sample ? <p className="t-tag t-faint">Ely read the example testnet wallet · connect yours to plan for real</p> : null}
                />
                {chat.pnlTurns.has(turn.id) && pnl && (turn.text.length > 0 || turn.doneAt !== null) && !turn.error ? (
                  <div className="ep-art">
                    <PnlCard figures={pnl} sample={pnlSample} />
                  </div>
                ) : null}
              </div>
            ),
          )}
          {chat.streaming ? null : (
            <div className="choices ep-chips" role="group" aria-label="Ask Ely about this portfolio">
              {FOLLOW_UPS.map((sentence) => (
                <button key={sentence} type="button" className={cx("choice", sentence === EXPLAIN_PNL && "rec", FOCUS_RING)} onClick={() => chat.send(sentence)}>
                  {sentence}
                </button>
              ))}
            </div>
          )}
          {sample && chat.turns.some((turn) => turn.kind === "ely" && !chat.pnlTurns.has(turn.id)) ? (
            <p className="t-tag t-faint !text-[9px]">
              The sample range is nobody&apos;s wallet: Ely answers from the example testnet wallet {shortAddr(chatAddress)}
            </p>
          ) : null}
        </div>
      </div>
      <div className="ep-compose">
        <Composer
          id="ely-composer"
          placeholder="Ask about your portfolio…"
          thinking={chat.streaming}
          onSend={chat.send}
          onStop={chat.stop}
          account={followed}
          sample={sample}
          phone={phone}
          compact
          minimal
          note="Ely drafts · your wallet signs · never withdraws"
          onAutopilot={() => onAutomationsOpen(true)}
        />
      </div>
      <Sheet open={opened !== null && openedPrimary !== null} onClose={() => setCardTurn(null)} side={phone ? "bottom" : "right"} title="Route card" className="ely2">
        {opened && openedPrimary ? (
          <div className={cx("-mx-6", phone ? "h-[70dvh]" : "h-[calc(100dvh-110px)]")}>
            <RouteArtifact key={opened.id} card={openedPrimary.card} proposal={openedPrimary.proposal} source={signSourceOf(opened, sentenceBefore(chat.turns, opened.id))} session={token} draftedAt={openedPrimary.at} stateKey={opened.id} variant="sheet" />
          </div>
        ) : null}
      </Sheet>
    </aside>
  );
}

function sentenceBefore(turns: readonly Turn[], turnId: string): string {
  const index = turns.findIndex((turn) => turn.id === turnId);
  for (let i = index - 1; i >= 0; i -= 1) {
    const turn = turns[i]!;
    if (turn.kind === "user") return turn.text;
  }
  return "";
}
