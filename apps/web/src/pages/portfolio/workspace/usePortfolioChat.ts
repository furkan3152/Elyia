/**
 * The Ely panel's conversation, scoped to the portfolio on screen: every
 * message goes to the real `POST /v1/agent/chat` stream about this address
 * (the labelled sample asks about the example testnet wallet, and says so).
 * "Explain my PnL" on the labelled sample is answered from the sample's own
 * figures without the API, since the sample range is nobody's wallet.
 * Nothing here signs: Ely answers with readings, text and route cards; a
 * card is signed in the wallet only when its button is pressed.
 */
import type { ChatClarifyAnswers } from "@elyia/core/api/agent";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { allAnswered, answersOf, pickedSummary } from "../../../features/ely/clarify";
import { streamChat } from "../../../features/ely/client";
import { applyEvent, interrupted, newElyTurn, type ElyTurn, type Turn } from "../../../features/ely/turn";
import { ApiError, describeError } from "../../../lib/api";
import { samplePnlTurn, wantsPnl } from "./model";

export interface PortfolioChatContext {
  /** The wallet Ely reads (the followed address, or the example wallet for the sample). */
  readonly address: string;
  readonly session: string | null;
  /** The range on screen is the labelled sample. */
  readonly sample: boolean;
  /** 30-day explain-PnL figures (the insight's, or the sample's). */
  readonly pnl: Readonly<Record<string, string | number | null>> | null;
}

export interface PortfolioChat {
  readonly turns: readonly Turn[];
  /** Ely turns that carry the PnL waterfall artifact. */
  readonly pnlTurns: ReadonlySet<string>;
  readonly streaming: boolean;
  send(text: string): void;
  stop(): void;
  answer(turnId: string, questionId: string, value: string): void;
}

let seq = 0;
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq += 1)}`;

export function usePortfolioChat(context: PortfolioChatContext): PortfolioChat {
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [pnlTurns, setPnlTurns] = useState<ReadonlySet<string>>(() => new Set());
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef(context);
  const turnsRef = useRef(turns);
  useLayoutEffect(() => {
    latest.current = context;
    turnsRef.current = turns;
  });

  // Another portfolio: another conversation.
  const scope = `${context.address}|${context.sample}`;
  const [shownScope, setShownScope] = useState(scope);
  if (shownScope !== scope) {
    setShownScope(scope);
    setTurns([]);
    setPnlTurns(new Set());
    setStreaming(false);
  }
  useEffect(() => () => controller.current?.abort(), [scope]);

  const patch = useCallback((id: string, fn: (turn: ElyTurn) => ElyTurn) => {
    setTurns((list) => list.map((turn) => (turn.kind === "ely" && turn.id === id ? fn(turn) : turn)));
  }, []);

  const run = useCallback(
    (message: string, display: string, clarify?: ChatClarifyAnswers) => {
      const ctx = latest.current;
      const text = message.trim().slice(0, 2_000);
      if (!text) return;
      const now = Date.now();
      const user: Turn = { kind: "user", id: uid("u"), text: display.trim().slice(0, 2_000) || text, at: now };
      const pnl = wantsPnl(text) && ctx.pnl !== null;
      if (ctx.sample && wantsPnl(text) && ctx.pnl) {
        const answer = samplePnlTurn(ctx.pnl, uid("e"), now);
        setTurns((list) => [...list, user, answer]);
        setPnlTurns((set) => new Set([...set, answer.id]));
        return;
      }
      const ely = newElyTurn(uid("e"), now);
      const serverThread = ctx.session ? ([...turnsRef.current].reverse().find((turn): turn is ElyTurn => turn.kind === "ely" && turn.serverThreadId !== null)?.serverThreadId ?? null) : null;
      setTurns((list) => [...list, user, ely]);
      if (pnl) setPnlTurns((set) => new Set([...set, ely.id]));
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setStreaming(true);
      void (async () => {
        try {
          await streamChat({
            request: { message: text, address: ctx.address, ...(serverThread ? { threadId: serverThread } : {}), ...(clarify ? { clarify } : {}) },
            session: ctx.session,
            signal: abort.signal,
            onEvent: (event) => patch(ely.id, (turn) => applyEvent(turn, event, Date.now())),
          });
          patch(ely.id, (turn) => interrupted(turn, Date.now()));
        } catch (error) {
          const why = abort.signal.aborted
            ? "Stopped. Nothing was proposed or signed."
            : error instanceof ApiError && error.code === "NETWORK_ERROR"
              ? "Ely could not reach the Elyia API. Check your connection, or that the API is running; nothing was sent."
              : describeError(error);
          patch(ely.id, (turn) => interrupted(turn, Date.now(), why));
        } finally {
          if (controller.current === abort) {
            controller.current = null;
            setStreaming(false);
          }
        }
      })();
    },
    [patch],
  );

  const send = useCallback((text: string) => run(text, text), [run]);
  const stop = useCallback(() => controller.current?.abort(), []);

  // A tapped choice; once every question has one, the sentence goes back to Ely with the answers.
  const answer = useCallback(
    (turnId: string, questionId: string, value: string) => {
      const turn = turnsRef.current.find((entry): entry is ElyTurn => entry.kind === "ely" && entry.id === turnId);
      const clarify = turn?.clarify;
      if (!turn || !clarify || clarify.sent) return;
      const picked = { ...clarify.picked, [questionId]: value };
      if (!allAnswered(clarify.questions, picked)) {
        patch(turnId, (entry) => (entry.clarify ? { ...entry, clarify: { ...entry.clarify, picked } } : entry));
        return;
      }
      const index = turnsRef.current.findIndex((entry) => entry.id === turnId);
      const sentence = clarify.sentence ?? [...turnsRef.current.slice(0, index)].reverse().find((entry) => entry.kind === "user")?.text ?? null;
      const display = pickedSummary(clarify.questions, picked);
      patch(turnId, (entry) => (entry.clarify ? { ...entry, clarify: { ...entry.clarify, picked, sent: display } } : entry));
      if (sentence) run(sentence, display, { ...(clarify.thread ? { thread: clarify.thread } : {}), answers: answersOf(clarify.questions, picked) });
    },
    [patch, run],
  );

  return { turns, pnlTurns, streaming, send, stop, answer };
}
