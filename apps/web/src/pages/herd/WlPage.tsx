import type { HerdMeResponse, HerdTask, HerdUsageScore } from "@elyia/core/api/herd";
import { normalizeXHandle } from "@elyia/core/api/herd";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useMemo, useRef, useState } from "react";

import { routeHref } from "../../app/routes/routeTable";
import { useApply, useMove, useWlMe, useWlTasks } from "../../features/herd/herdApi";
import { evidenceProblem, raiseTips, reachableSteps, shareIntent, short, STATUS_WORDS, WL_STEPS, wlStep, type WlStep } from "../../features/herd/herdModel";
import { SessionBar } from "../../features/session";
import { SessionBridge } from "../../features/session/SessionBridge";
import { useWalletSession } from "../../features/session/useWalletSession";
import { describeError } from "../../lib/api";
import { Page, Section } from "../../pixel/layout";
import { Button, ButtonLink } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { BlockBar, Chip, TestnetBadge } from "./parts/ui";
import { WlCard, type WlCardHandle } from "./parts/WlCard";

interface Draft {
  readonly handle: string;
  readonly evidence: Readonly<Record<string, string>>;
}

const DRAFT_KEY = "elyia.herd.wl.draft";

function loadDraft(wallet: string | null): Draft {
  if (!wallet || typeof sessionStorage === "undefined") return { handle: "", evidence: {} };
  try {
    const raw = JSON.parse(sessionStorage.getItem(`${DRAFT_KEY}.${wallet}`) ?? "null") as Draft | null;
    return raw && typeof raw.handle === "string" ? raw : { handle: "", evidence: {} };
  } catch {
    return { handle: "", evidence: {} };
  }
}

/** A coarse device hash (browser family, time zone, screen bucket, language), hashed again on the server. */
async function deviceHash(): Promise<string | undefined> {
  try {
    const parts = [navigator.userAgent.replace(/[\d.]+/gu, ""), Intl.DateTimeFormat().resolvedOptions().timeZone, `${Math.round(screen.width / 100)}x${Math.round(screen.height / 100)}`, navigator.language].join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
  } catch {
    return undefined;
  }
}

function Stepper({ step, reachable, onPick }: { readonly step: WlStep; readonly reachable: readonly WlStep[]; readonly onPick: (step: WlStep) => void }) {
  return (
    <ol className="m-0 mb-8 grid list-none grid-cols-3 gap-[2px] bg-rule p-[2px] sm:grid-cols-6" aria-label="Application steps">
      {WL_STEPS.map((entry, index) => {
        const open = reachable.includes(entry.id);
        const current = entry.id === step;
        return (
          <li key={entry.id}>
            <button type="button" disabled={!open} aria-current={current ? "step" : undefined} onClick={() => onPick(entry.id)} className={cx("flex w-full flex-col items-center gap-0.5 px-2 py-2.5 font-tag text-[10px] uppercase disabled:cursor-not-allowed", current ? "bg-accent text-accent-ink" : open ? "bg-card text-ink hover:bg-paper-2" : "bg-paper-2 text-ink-3", FOCUS_RING)}>
              <span className="tnum">{index + 1}</span>
              {entry.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ScorePanel({ score, compact = false }: { readonly score: HerdUsageScore | null | undefined; readonly compact?: boolean }) {
  const tips = raiseTips(score);
  return (
    <div className="flex flex-col gap-3 bg-card p-5 px-frame">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[19px] font-bold text-ink">Your usage score</h2>
        <span className="font-display text-[34px] font-bold leading-none text-ink tnum">
          {score?.score ?? "—"}
          <span className="text-[16px] text-ink-3">/100</span>
        </span>
      </div>
      <BlockBar fraction={(score?.score ?? 0) / 100} label={`Usage score ${score?.score ?? 0} of 100`} tone="sig" />
      <p className="text-[12px] text-ink-2">Raffle weight <b className="tnum">{score ? `${score.weight.toFixed(2)}×` : "—"}</b> (1 + score/25, at most 5×). The more you use Elyia, the higher your chance.</p>
      {!compact && score ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {score.components.map((component) => (
            <li key={component.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-dashed border-rule py-1.5 text-[12.5px] last:border-b-0">
              <span className="text-ink">{component.label}</span>
              <span className="font-mono text-ink tnum">
                {component.points}/{component.max}
              </span>
              <span className="col-span-2 text-[11.5px] text-ink-3">{component.measure}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {tips.length > 0 ? (
        <div className="bg-paper p-3 px-frame-thin">
          <b className="font-tag text-[10px] uppercase text-accent">Raise your chance by using Elyia</b>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0 text-[12px] text-ink-2">
            {tips.slice(0, compact ? 2 : 4).map((tip) => (
              <li key={tip.label}>
                <b className="text-ink">+{tip.left}</b> {tip.label}: {tip.tip}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <ButtonLink to={routeHref("deck")} variant="ink" size="xs">Ask Ely</ButtonLink>
            <ButtonLink to={routeHref("portfolio")} variant="ink" size="xs">Automations</ButtonLink>
            <ButtonLink to={routeHref("developers")} variant="ink" size="xs">Developer key</ButtonLink>
          </div>
        </div>
      ) : null}
      <p className="text-[11px] text-ink-3">Transparent and capped: whales do not dominate. Settled routes, active days, layers, venues, journeys, automations, volume tier, a developer key in use, and tasks.</p>
    </div>
  );
}

function TaskRow({ task, value, onChange, handle }: { readonly task: HerdTask; readonly value: string; readonly onChange: (next: string) => void; readonly handle: string | null }) {
  const problem = value || task.evidence === "x-handle" ? evidenceProblem(task, value, handle) : null;
  return (
    <li className="flex flex-col gap-2 bg-card p-4 px-frame">
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1 font-display text-[16px] text-ink">{task.label}</b>
        <Chip tone="mute">{task.points} pts</Chip>
        <Chip tone={task.required ? "acc" : "mute"}>{task.required ? "required" : "optional"}</Chip>
      </div>
      {task.description ? <p className="text-[12.5px] text-ink-2">{task.description}</p> : null}
      {task.kind !== "share-card" ? (
        task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer noopener" className={cx("self-start text-[12.5px] text-accent underline", FOCUS_RING)}>
            Open {task.kind === "follow-x" ? "the profile" : "the post"} ↗
          </a>
        ) : (
          <Chip tone="warn" className="self-start">Link not configured yet · the team adds it soon</Chip>
        )
      ) : null}
      {task.evidence === "x-handle" ? (
        <p className="text-[12px] text-ink-3">{handle ? `Checked against @${handle}.` : "Enter your X handle above."} {task.verification === "manual" ? "An admin reviews it." : ""}</p>
      ) : task.evidence !== "none" ? (
        <label className="flex flex-col gap-1">
          <span className="font-tag text-[10px] uppercase text-ink-2">{task.evidence === "tweet-url" ? "Link to your post" : task.evidence === "post-url" ? "Link" : "Answer"}</span>
          <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={task.evidence === "tweet-url" ? `https://x.com/${handle ?? "you"}/status/…` : ""} className={cx("h-10 bg-paper px-3 font-mono text-[12.5px] text-ink px-frame-thin", FOCUS_RING)} aria-invalid={Boolean(problem)} />
          {problem ? <span className="text-[11.5px] text-down">{problem}</span> : null}
        </label>
      ) : null}
    </li>
  );
}

function StatusView({ me, onReapply, testnet }: { readonly me: HerdMeResponse; readonly onReapply: () => void; readonly testnet: boolean }) {
  const app = me.application!;
  const words = STATUS_WORDS[app.status] ?? STATUS_WORDS.pending!;
  const move = useMove();
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  return (
    <div className="flex flex-col gap-4">
      <div className={cx("flex flex-col gap-2 p-5 px-frame", words.tone === "up" ? "bg-up/10" : words.tone === "dn" ? "bg-down/10" : words.tone === "warn" ? "bg-warn/15" : "bg-card")}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={words.tone}>{words.label}</Chip>
          <span className="font-tag text-[10px] uppercase text-ink-3">
            @{app.xHandle} · {short(app.wallet)} · applied {app.createdAt.slice(0, 10)}
            {app.attempts > 1 ? ` · attempt ${app.attempts}` : ""}
          </span>
        </div>
        <p className="text-[14px] text-ink">{words.detail}</p>
        {app.status === "approved" ? <ButtonLink to="/herd" variant="primary" className="self-start">Go to the mint</ButtonLink> : null}
        {app.status === "rejected" ? (
          me.reapplyLeft > 0 && me.canApply ? (
            <Button variant="primary" className="self-start" onClick={onReapply}>
              Re-apply ({me.reapplyLeft} left)
            </Button>
          ) : (
            <p className="text-[12.5px] text-ink-2">{me.reason ?? "No re-application left."}</p>
          )
        ) : null}
        {app.status === "pending" || app.status === "waitlist" ? (
          <Button variant="ink" size="sm" className="self-start" onClick={onReapply}>
            Edit my answers
          </Button>
        ) : null}
        {testnet ? <p className="text-[11.5px] text-ink-3">Testnet: approved wallets and testnet minters also go on the mainnet WL snapshot.</p> : null}
      </div>
      <div className="bg-card p-5 px-frame">
        <h3 className="font-display text-[17px] font-bold text-ink">Task checks</h3>
        <ul className="m-0 mt-2 flex list-none flex-col p-0 text-[12.5px]">
          {app.tasks.map((task) => (
            <li key={task.taskId} className="flex flex-wrap items-center gap-2 border-b border-dashed border-rule py-1.5 last:border-b-0">
              <Chip tone={task.state === "verified" ? "up" : task.state === "failed" ? "dn" : task.state === "missing" ? "mute" : "acc"}>{task.state}</Chip>
              <span className="min-w-0 flex-1 truncate text-ink-2">{task.evidence ?? task.taskId}</span>
              {task.detail ? <span className="text-[11.5px] text-ink-3">{task.detail}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <details className="bg-card p-5 px-frame">
        <summary className={cx("cursor-pointer font-display text-[16px] font-bold text-ink", FOCUS_RING)}>Changed wallets?</summary>
        <p className="mt-2 text-[12.5px] text-ink-2">Moving needs both wallets: start here from the old one, then sign in with the new one and accept within 30 minutes. A wallet that already minted cannot move its spot.</p>
        {me.pendingMove ? <p className="mt-2 text-[12.5px] text-accent">Move to {short(me.pendingMove.to)} started; accept it from that wallet before {me.pendingMove.expiresAt.slice(11, 16)} UTC.</p> : null}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-tag text-[10px] uppercase text-ink-2">New wallet</span>
            <input value={to} onChange={(event) => setTo(event.target.value.trim())} placeholder="0x…" className={cx("h-10 bg-paper px-3 font-mono text-[12.5px] text-ink px-frame-thin", FOCUS_RING)} />
            <Button variant="ink" size="sm" disabled={!/^0x[0-9a-fA-F]{40}$/u.test(to)} loading={move.start.isPending} onClick={() => void move.start.mutateAsync(to)}>
              Start the move
            </Button>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-tag text-[10px] uppercase text-ink-2">Accept a move from</span>
            <input value={from} onChange={(event) => setFrom(event.target.value.trim())} placeholder="0x… old wallet" className={cx("h-10 bg-paper px-3 font-mono text-[12.5px] text-ink px-frame-thin", FOCUS_RING)} />
            <Button variant="ink" size="sm" disabled={!/^0x[0-9a-fA-F]{40}$/u.test(from)} loading={move.accept.isPending} onClick={() => void move.accept.mutateAsync(from)}>
              Accept here
            </Button>
          </label>
        </div>
        {move.start.error || move.accept.error ? <p role="alert" className="mt-2 text-[12px] text-down">{describeError(move.start.error ?? move.accept.error)}</p> : null}
      </details>
    </div>
  );
}

/**
 * /herd/wl: connect, sign in (SIWE), tasks, the shareable card (download +
 * X intent), submit, then the status page with the score breakdown. One
 * application per wallet; the wallet is the signed-in one.
 */
export default function WlPage() {
  const session = useWalletSession();
  const { openConnectModal } = useConnectModal();
  const tasks = useWlTasks();
  const me = useWlMe(session.token);
  const apply = useApply();
  const [wanted, setWanted] = useState<WlStep | null>(null);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(session.address));
  const [draftFor, setDraftFor] = useState(session.address);
  if (draftFor !== session.address) {
    setDraftFor(session.address);
    setDraft(loadDraft(session.address));
  }
  useEffect(() => {
    if (session.address) sessionStorage.setItem(`${DRAFT_KEY}.${session.address}`, JSON.stringify(draft));
  }, [draft, session.address]);
  const editing = wanted === "tasks" || wanted === "card" || wanted === "submit";
  const reachInput = { connected: Boolean(session.address), signedIn: Boolean(session.token), me: me.data };
  const reachable = reachableSteps(reachInput);
  const step = wlStep({ ...reachInput, wanted });
  const handle = normalizeXHandle(draft.handle);
  const list = tasks.data?.tasks ?? [];
  const problems = list.map((task) => (task.required || draft.evidence[task.id] ? evidenceProblem(task, draft.evidence[task.id] ?? "", handle) : null));
  const ready = Boolean(handle) && problems.every((problem) => problem === null);
  const testnet = true;
  const referredBy = useMemo(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("ref")), []);
  const card = useRef<WlCardHandle>(null);
  const shareTask = list.find((task) => task.kind === "share-card");
  const score = me.data?.application?.score ?? me.data?.score ?? null;
  const pageUrl = typeof window === "undefined" ? "https://elyia/herd/wl" : `${window.location.origin}/herd/wl`;
  const referral = me.data?.application?.referral ?? null;

  const setEvidence = (id: string, value: string) => setDraft((current) => ({ ...current, evidence: { ...current.evidence, [id]: value } }));
  const submit = async () => {
    if (!session.address) return;
    try {
      await apply.mutateAsync({ wallet: session.address, xHandle: draft.handle, evidence: draft.evidence, ...(referredBy && /^[0-9a-f]{8}$/u.test(referredBy) ? { referredBy } : {}), device: await deviceHash() });
      setWanted("status");
    } catch {
      // shown below
    }
  };
  const download = async () => {
    const blob = await card.current?.toBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `herd-wl-card-${session.address?.slice(2, 8) ?? "me"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <Page>
      <SessionBridge />
      <Section level={1} seam={false} tag="The Herd · WL application" title="Join the herd's WL." lede="Sign in with your wallet, do three small tasks, share your card. A usage-weighted raffle picks the WL: the more you use Elyia, the higher your chance." actions={<TestnetBadge testnet={testnet} />}>
        <Stepper step={step} reachable={reachable} onPick={setWanted} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            {tasks.data && !tasks.data.applicationsOpen ? <Chip tone="warn" className="self-start">Applications are closed right now</Chip> : null}
            {step === "connect" ? (
              <div className="flex flex-col items-center gap-4 bg-card p-8 text-center px-frame">
                <h2 className="font-display text-[24px] font-bold text-ink">1 · Connect your wallet</h2>
                <p className="max-w-[420px] text-[13.5px] text-ink-2">The wallet you apply with is the wallet that mints. One application per wallet.</p>
                <Button variant="primary" size="lg" onClick={openConnectModal} className="portal-pulse">
                  Connect wallet
                </Button>
              </div>
            ) : null}
            {step === "sign-in" ? (
              <div className="flex flex-col items-center gap-4 bg-card p-8 text-center px-frame">
                <h2 className="font-display text-[24px] font-bold text-ink">2 · Sign in</h2>
                <p className="max-w-[420px] text-[13.5px] text-ink-2">Sign a message to prove you hold {short(session.address)}. It moves no funds and costs no gas.</p>
                <SessionBar purpose="apply for the Herd WL" variant="panel" />
              </div>
            ) : null}
            {step === "tasks" ? (
              <div className="flex flex-col gap-4">
                <h2 className="font-display text-[24px] font-bold text-ink">3 · Tasks</h2>
                <label className="flex flex-col gap-1 bg-card p-4 px-frame">
                  <span className="font-tag text-[10px] uppercase text-ink-2">Your X handle</span>
                  <input value={draft.handle} onChange={(event) => setDraft((current) => ({ ...current, handle: event.target.value }))} placeholder="@yourhandle" className={cx("h-10 bg-paper px-3 font-mono text-[13px] text-ink px-frame-thin", FOCUS_RING)} />
                  <span className="text-[11.5px] text-ink-3">{draft.handle && !handle ? "Letters, digits and _, up to 15." : "One X account, one application. Self-reported links are reviewed by the team."}</span>
                </label>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {list
                    .filter((task) => task.kind !== "share-card")
                    .map((task) => (
                      <TaskRow key={task.id} task={task} value={draft.evidence[task.id] ?? ""} onChange={(next) => setEvidence(task.id, next)} handle={handle} />
                    ))}
                </ul>
                <Button variant="primary" onClick={() => setWanted("card")} disabled={!handle} className="self-end">
                  Next: your card →
                </Button>
              </div>
            ) : null}
            {step === "card" && session.address ? (
              <div className="flex flex-col gap-4">
                <h2 className="font-display text-[24px] font-bold text-ink">4 · Share your card</h2>
                <div className="bg-card p-2 px-frame px-drop">
                  <WlCard ref={card} wallet={session.address} handle={handle} score={score?.score ?? null} weight={score?.weight ?? null} referral={referral} testnet={testnet} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ink" onClick={() => void download()}>
                    Download PNG
                  </Button>
                  <a href={shareIntent({ handle, referral, pageUrl, score: score?.score ?? null, testnet })} target="_blank" rel="noreferrer noopener">
                    <Button variant="signpost">Post on X ↗</Button>
                  </a>
                </div>
                <p className="text-[12px] text-ink-3">Attach the downloaded card to your post. Elyia never posts for you and never logs in to X.</p>
                {shareTask ? <TaskRow task={shareTask} value={draft.evidence[shareTask.id] ?? ""} onChange={(next) => setEvidence(shareTask.id, next)} handle={handle} /> : null}
                <Button variant="primary" onClick={() => setWanted("submit")} className="self-end">
                  Next: submit →
                </Button>
              </div>
            ) : null}
            {step === "submit" ? (
              <div className="flex flex-col gap-4 bg-card p-5 px-frame">
                <h2 className="font-display text-[24px] font-bold text-ink">5 · Submit</h2>
                <ul className="m-0 flex list-none flex-col p-0 text-[13px]">
                  <li className="flex justify-between border-b border-dashed border-rule py-1.5">
                    <span className="text-ink-3">Wallet</span>
                    <span className="font-mono text-ink">{short(session.address)}</span>
                  </li>
                  <li className="flex justify-between border-b border-dashed border-rule py-1.5">
                    <span className="text-ink-3">X</span>
                    <span className="text-ink">{handle ? `@${handle}` : "—"}</span>
                  </li>
                  {list.map((task, index) => (
                    <li key={task.id} className="flex justify-between gap-3 border-b border-dashed border-rule py-1.5 last:border-b-0">
                      <span className="text-ink-3">{task.label}</span>
                      <span className={problems[index] ? "text-down" : "text-up"}>{problems[index] ?? "✓"}</span>
                    </li>
                  ))}
                </ul>
                {apply.error ? <p role="alert" className="text-[12.5px] text-down">{describeError(apply.error)}</p> : null}
                <Button variant="primary" size="lg" disabled={!ready || tasks.data?.applicationsOpen === false} loading={apply.isPending} onClick={() => void submit()} className={ready ? "portal-pulse" : undefined}>
                  {me.data?.application ? "Update my application" : "Submit application"}
                </Button>
                <p className="text-[11.5px] text-ink-3">One application per wallet. {me.data && me.data.reapplyLeft >= 0 ? `After a rejection you may re-apply ${me.data.reapplyLeft === 1 ? "once" : `${me.data.reapplyLeft} times`}.` : ""}</p>
              </div>
            ) : null}
            {step === "status" && me.data?.application && !editing ? <StatusView me={me.data} testnet={testnet} onReapply={() => setWanted("tasks")} /> : null}
            {me.isError ? <p className="text-[12.5px] text-down">Could not load your application: {describeError(me.error)}</p> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <ScorePanel score={score} compact={step !== "status"} />
            {!session.token ? <p className="text-center text-[12px] text-ink-3">Sign in to see your own score.</p> : null}
          </div>
        </div>
      </Section>
    </Page>
  );
}
