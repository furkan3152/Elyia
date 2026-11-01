import "../../features/ely/ely.css";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";

import { navigate } from "../../app/routes/history";
import { routeHref } from "../../app/routes/routeTable";
import { useRoute } from "../../app/routes/useRoute";
import { RouteArtifact, ArtifactWaiting } from "../../features/ely/RouteArtifact";
import type { Recipe } from "../../features/ely/recipes";
import { useWalletSession } from "../../features/session/useWalletSession";
import { activeThread, answerClarify, sendMessage, stopThread, useChatStore } from "../../features/ely/store";
import { planning, primaryCard, type ElyTurn, type Turn } from "../../features/ely/turn";
import { signSourceOf } from "../../features/ely/signSource";
import { useMediaQuery, useShellHeight, useStickToBottom } from "../../features/ely/hooks";
import { Sheet } from "../../ui/Sheet";
import { cx, FOCUS_RING } from "../../ui/cx";
import { EXAMPLE_ADDRESS } from "../portfolio/range/sample";
import { useRange } from "../portfolio/range/useRange";
import { Composer } from "../../features/ely/Composer";
import { EmptyState } from "./parts/EmptyState";
import { ElyMessage, UserMessage } from "../../features/ely/Messages";
import { Rail } from "./parts/Rail";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
/** Deep links already sent (by location key), so a re-render never sends twice. */
const handledIntents = new Set<number>();

type Panel = { readonly kind: "turn"; readonly turnId: string } | { readonly kind: "recipe"; readonly recipe: Recipe } | null;


/**
 * "/app": Ask Ely, the chat-first home. A rail of threads beside the
 * conversation; the empty state asks "Where to?" with four suggestions and
 * the live mini range; a conversation is driven by the agent's real stream
 * (readings become chips, questions become choices, text streams, proposals
 * become the route card), and the route card opens as an equal half beside
 * it (a bottom sheet on phones) with the real sign flow. `?intent=` prefills
 * and sends; `?as=0x…` asks about a watched address.
 */
export default function AskPage() {
  const { location } = useRoute();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const intent = params.get("intent");
  const asParam = params.get("as");
  const { address: connected } = useAccount();
  const session = useWalletSession();
  const wide = useMediaQuery("(min-width: 1024px)", true);
  const phone = !useMediaQuery("(min-width: 768px)", true);
  const height = useShellHeight(phone);

  const threads = useChatStore((state) => state.threads);
  const activeId = useChatStore((state) => state.activeId);
  const live = useChatStore((state) => state.live);
  const setActive = useChatStore((state) => state.setActive);
  const thread = activeThread({ threads, activeId });

  const watched = asParam && ADDRESS.test(asParam) ? asParam.toLowerCase() : null;
  const followed = watched ?? connected?.toLowerCase() ?? null;
  const sample = followed === null;
  const address = followed ?? EXAMPLE_ADDRESS;
  const token = session.token && followed === session.address ? session.token : null;
  const context = useMemo(() => ({ address, session: token }), [address, token]);
  const range = useRange(followed);

  const [panel, setPanel] = useState<Panel>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [closedAuto, setClosedAuto] = useState<readonly string[]>([]);

  const send = (text: string) => {
    setPanel(null);
    sendMessage(text, context);
  };

  const newClimb = () => {
    setActive(null);
    setPanel(null);
    setRailOpen(false);
  };

  // ?intent= (⌘K, the WhereTo box, the landing): prefill and send once, then drop it from the URL.
  useEffect(() => {
    if (!intent || handledIntents.has(location.key)) return;
    handledIntents.add(location.key);
    setActive(null);
    sendMessage(intent.slice(0, 500), context);
    const keep = new URLSearchParams(location.search);
    keep.delete("intent");
    const rest = keep.toString();
    navigate(`${routeHref("deck")}${rest ? `?${rest}` : ""}`, { replace: true });
  }, [intent, location.key, location.search, context, setActive]);

  // Open the panel on "Surveying the route…" as soon as a planning reading starts (desktop), until it is closed.
  const lastEly = thread ? ([...thread.turns].reverse().find((turn): turn is ElyTurn => turn.kind === "ely") ?? null) : null;
  const lastId = lastEly?.id ?? null;
  const autoPanel: Panel = wide && lastEly && lastId && planning(lastEly) && !closedAuto.includes(lastId) ? { kind: "turn", turnId: lastId } : null;
  // A panel that belongs to another thread is not shown.
  const chosen: Panel = panel?.kind === "turn" && !thread?.turns.some((turn) => turn.id === panel.turnId) ? null : panel;
  const shown: Panel = chosen ?? autoPanel;
  const closePanel = () => {
    if (shown?.kind === "turn") setClosedAuto((list) => [...list.slice(-20), shown.turnId]);
    setPanel(null);
  };

  const openCard = (turnId: string) => {
    setPanel({ kind: "turn", turnId });
    if (!wide) setSheetOpen(true);
  };

  const panelTurn = shown?.kind === "turn" && thread ? (thread.turns.find((turn): turn is ElyTurn => turn.kind === "ely" && turn.id === shown.turnId) ?? null) : null;
  const panelSentence = panelTurn && thread ? sentenceBefore(thread.turns, panelTurn.id) : "";
  const panelPrimary = panelTurn ? primaryCard(panelTurn) : null;
  let artifact: ReactNode = null;
  if (shown?.kind === "recipe") {
    artifact = <RouteArtifact key={shown.recipe.id} card={shown.recipe.card} proposal={null} source={shown.recipe.source} draftedAt={shown.recipe.savedAt} onClose={closePanel} variant={wide ? "panel" : "sheet"} />;
  } else if (panelTurn && panelPrimary) {
    artifact = <RouteArtifact key={panelTurn.id} card={panelPrimary.card} proposal={panelPrimary.proposal} source={signSourceOf(panelTurn, panelSentence)} session={token} draftedAt={panelPrimary.at} onClose={closePanel} variant={wide ? "panel" : "sheet"} />;
  } else if (panelTurn && panelTurn.doneAt === null && !panelTurn.error) {
    artifact = <ArtifactWaiting onClose={closePanel} />;
  }
  const split = wide && artifact !== null;
  const streaming = thread ? Boolean(live[thread.id]) : false;

  const rail = (
    <Rail
      threads={threads}
      activeId={activeId}
      liveIds={live}
      onNew={newClimb}
      onPick={(id) => {
        setActive(id);
        setRailOpen(false);
      }}
      onRecipe={(recipe) => {
        setPanel({ kind: "recipe", recipe });
        setRailOpen(false);
        if (!wide) setSheetOpen(true);
      }}
      ropes={range.ropes}
      ropesSample={range.source === "sample"}
      address={followed}
      sample={sample}
      token={token}
      signingIn={session.busy}
      onSignIn={() => void session.signIn()}
      onSignOut={session.signOut}
      connected={Boolean(connected) && !watched}
    />
  );

  const composer = (
    <Composer
      placeholder={thread ? (phone ? "Ask Ely…" : "Reply to Ely…") : phone ? "Ask Ely…" : "Ask Ely: swap, climb, protect, explain…"}
      thinking={streaming}
      onSend={send}
      onStop={thread ? () => stopThread(thread.id) : undefined}
      account={followed}
      sample={sample}
      phone={phone}
      autoFocus={!phone && !thread}
      compact={split}
    />
  );

  return (
    <div className="ely2 grid" style={{ height, gridTemplateColumns: wide ? "272px minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
      {wide ? rail : null}
      {thread ? (
        <div className="grid min-h-0" style={{ gridTemplateColumns: split ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)" }}>
          <ThreadColumn
            title={thread.title}
            turns={thread.turns}
            phone={phone}
            split={split}
            onThreads={wide ? undefined : () => setRailOpen(true)}
            onNew={newClimb}
            openTurnId={shown?.kind === "turn" ? shown.turnId : null}
            onOpenCard={openCard}
            onAnswer={(turnId, questionId, value) => void answerClarify(thread.id, turnId, questionId, value, context)}
            signInHint={
              !token && connected && !watched ? (
                <p className="t-tag t-faint">
                  Anyone can sign this card ·{" "}
                  <button type="button" onClick={() => void session.signIn()} className={cx("t-acc underline", FOCUS_RING)}>
                    sign in
                  </button>{" "}
                  and Ely files it as a proposal
                </p>
              ) : sample ? (
                <p className="t-tag t-faint">Ely read the labelled sample wallet · connect yours to plan for real</p>
              ) : null
            }
            composer={composer}
          />
          {split ? <div className="min-h-0 overflow-hidden">{artifact}</div> : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-col">
          {wide ? null : (
            <div className="flex items-center justify-between px-4 pt-3">
              <button type="button" onClick={() => setRailOpen(true)} className={cx("b xs", FOCUS_RING)}>
                ☰ Threads
              </button>
              <span className="t-tag t-faint">{sample ? "sample wallet" : `${followed!.slice(0, 6)}…${followed!.slice(-4)}`}</span>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className={cx("m-auto flex w-full max-w-[848px] flex-col", phone ? "px-4 py-3" : "px-6 py-4")}>
              <EmptyState onPick={send} phone={phone} />
            </div>
          </div>
          <div className={cx("mx-auto w-full max-w-[848px] shrink-0", phone ? "px-3 pb-1 pt-3" : "px-6 pb-3 pt-4")}>{composer}</div>
        </div>
      )}
      {wide ? null : (
        <>
          <Sheet open={railOpen} onClose={() => setRailOpen(false)} title="Threads" side="right" className="ely2">
            <div className="-mx-4 h-[75dvh]">{rail}</div>
          </Sheet>
          <Sheet open={sheetOpen && artifact !== null} onClose={() => setSheetOpen(false)} side="bottom" title={panelPrimary ? `Route card` : shown?.kind === "recipe" ? "Recipe" : "Route card"} className="ely2">
            <div className="-mx-4 h-[70dvh]">{artifact}</div>
          </Sheet>
        </>
      )}
    </div>
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

interface ThreadColumnProps {
  readonly title: string;
  readonly turns: readonly Turn[];
  readonly phone: boolean;
  readonly split: boolean;
  readonly onThreads?: () => void;
  readonly onNew: () => void;
  readonly openTurnId: string | null;
  readonly onOpenCard: (turnId: string) => void;
  readonly onAnswer: (turnId: string, questionId: string, value: string) => void;
  readonly signInHint: ReactNode;
  readonly composer: ReactNode;
}

function ThreadColumn({ title, turns, phone, split, onThreads, onNew, openTurnId, onOpenCard, onAnswer, signInHint, composer }: ThreadColumnProps) {
  const { scroller, content } = useStickToBottom(turns.length);

  return (
    <section className={cx("flex min-h-0 flex-col", split && "shadow-[inset_-2px_0_0_0_rgb(var(--rule))]")} aria-label={`Conversation: ${title}`}>
      <div className={cx("flex items-center gap-3 shadow-[inset_0_-2px_0_0_rgb(var(--rule))]", phone ? "px-4 py-2.5" : "px-8 py-3.5")}>
        {onThreads ? (
          <button type="button" onClick={onThreads} className={cx("b xs", FOCUS_RING)} aria-label="Threads">
            ☰
          </button>
        ) : null}
        <h1 className={cx("disp min-w-0 flex-1 truncate", phone ? "text-[15px]" : "text-[17px]")}>{title}</h1>
        <span className="pill acc">Propose · you sign</span>
        {phone ? (
          <button type="button" onClick={onNew} className={cx("b xs acc", FOCUS_RING)} aria-label="New climb">
            +
          </button>
        ) : null}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content} className={cx("mx-auto flex min-h-full w-full max-w-[800px] flex-col justify-end gap-[14px]", phone ? "px-4 py-4" : "px-8 py-4")}>
          {turns.map((turn) =>
            turn.kind === "user" ? (
              <UserMessage key={turn.id} text={turn.text} />
            ) : (
              <ElyMessage key={turn.id} turn={turn} phone={phone} opened={openTurnId === turn.id} onOpenCard={() => onOpenCard(turn.id)} onAnswer={(questionId, value) => onAnswer(turn.id, questionId, value)} signInHint={signInHint} />
            ),
          )}
        </div>
      </div>
      <div className={cx("mx-auto w-full max-w-[800px] pt-10", phone ? "px-3 pb-2" : "px-8 pb-4")}>{composer}</div>
    </section>
  );
}
