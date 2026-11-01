import type { HerdApplication, HerdApplicationStatus, HerdApplicationsQuery } from "@elyia/core/api/herd";
import { useState } from "react";

import { downloadExport, useApplications, useHerdAdmin, type HerdOverview } from "../../../features/herd/herdApi";
import { short } from "../../../features/herd/herdModel";
import { describeError } from "../../../lib/api";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { toast } from "../../../ui/toast";
import { Card, Pill, SectionHead } from "../../developers/portal/ui";
import { TextField } from "./fields";

const STATUSES: readonly (HerdApplicationStatus | "all")[] = ["pending", "approved", "waitlist", "rejected", "all"];
const STATUS_TONE: Readonly<Record<HerdApplicationStatus, "acc" | "up" | "warn" | "dn">> = { pending: "acc", approved: "up", waitlist: "warn", rejected: "dn" };

/** The applications queue: filters, bulk approve / reject / waitlist with a note, flags, notes, score. */
export function HerdQueue({ overview }: { readonly overview: HerdOverview | undefined }) {
  const [status, setStatus] = useState<HerdApplicationStatus | "all">("pending");
  const [minScore, setMinScore] = useState("");
  const [flagged, setFlagged] = useState<"any" | "yes" | "no">("any");
  const [tasksDone, setTasksDone] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"score" | "created" | "updated">("score");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const query: HerdApplicationsQuery = {
    ...(status !== "all" ? { status } : {}),
    ...(/^\d+$/u.test(minScore) ? { minScore: Number(minScore) } : {}),
    ...(flagged !== "any" ? { flagged: flagged === "yes" } : {}),
    ...(tasksDone ? { tasksDone: true } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
    sort,
    limit: 50,
    ...(cursor ? { cursor } : {}),
  };
  const list = useApplications(query, true);
  const admin = useHerdAdmin();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = list.data?.applications ?? [];
  const counts = list.data?.counts ?? overview?.counts;

  const decide = async (next: HerdApplicationStatus) => {
    try {
      const result = await admin.decide.mutateAsync({ ids: [...selected], status: next, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(`${result.updated} ${next}`, { description: next === "approved" ? "Rebuild the WL list and publish its root." : undefined });
      setSelected(new Set());
      setNote("");
    } catch (error) {
      toast.error("Decision failed", { description: describeError(error) });
    }
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <section id="herd-queue" aria-labelledby="herd-queue-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="herd-queue-title" tag="Applications queue" title="Review, decide, note." lede="Filter by status, score, flags and tasks. Select rows to approve, reject or waitlist in bulk, with a note. Flags are coarse signals (hashed network and device, fresh wallets, reused handles): a human decides." />
      <div role="tablist" aria-label="Status" className="mx-auto mb-4 flex w-full flex-wrap justify-center gap-[2px] bg-rule p-[2px] sm:w-fit">
        {STATUSES.map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={status === entry} onClick={() => { setStatus(entry); setCursor(undefined); setSelected(new Set()); }} className={cx("px-3 py-2 font-tag text-[10px] uppercase", status === entry ? "bg-accent text-accent-ink" : "bg-card text-ink-2 hover:bg-paper-2")}>
            {entry} {counts ? `· ${entry === "all" ? counts.total : counts[entry]}` : ""}
          </button>
        ))}
      </div>
      <Card className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <TextField label="Search" value={q} onChange={(next) => { setQ(next); setCursor(undefined); }} placeholder="wallet, @handle, id" className="col-span-2" />
          <TextField label="Min score" value={minScore} onChange={(next) => { setMinScore(next); setCursor(undefined); }} placeholder="0-100" />
          <label className="flex flex-col gap-1">
            <span className="font-tag text-[10px] uppercase text-ink-2">Flags</span>
            <select value={flagged} onChange={(event) => setFlagged(event.target.value as never)} className="h-9 bg-paper px-2 text-[12.5px] text-ink px-frame-thin">
              <option value="any">any</option>
              <option value="yes">flagged ({counts?.flagged ?? 0})</option>
              <option value="no">clean</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-tag text-[10px] uppercase text-ink-2">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as never)} className="h-9 bg-paper px-2 text-[12.5px] text-ink px-frame-thin">
              <option value="score">score</option>
              <option value="created">oldest</option>
              <option value="updated">recently updated</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-[12px] text-ink-2">
            <input type="checkbox" checked={tasksDone} onChange={(event) => setTasksDone(event.target.checked)} /> tasks done
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t-2 border-dashed border-rule pt-3">
          <span className="font-tag text-[10px] uppercase text-ink-2">{selected.size} selected</span>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set(rows.map((row) => row.id)))}>
            Select page
          </Button>
          <TextField label="Note (optional)" value={note} onChange={setNote} className="min-w-[200px] flex-1" />
          <Button variant="primary" size="sm" disabled={selected.size === 0} loading={admin.decide.isPending} onClick={() => void decide("approved")}>Approve</Button>
          <Button variant="ink" size="sm" disabled={selected.size === 0} onClick={() => void decide("waitlist")}>Waitlist</Button>
          <Button variant="danger" size="sm" disabled={selected.size === 0} onClick={() => void decide("rejected")}>Reject</Button>
          <Button variant="ghost" size="sm" loading={admin.rescore.isPending} onClick={() => void admin.rescore.mutateAsync(undefined).then((result) => toast.success(`Rescored ${result.rescored}`))}>Rescore all</Button>
          <Button variant="ghost" size="sm" onClick={() => void downloadExport("/v1/admin/herd/applications/export?format=csv", "herd-applications.csv").catch((error: unknown) => toast.error("Export failed", { description: describeError(error) }))}>CSV</Button>
          <Button variant="ghost" size="sm" onClick={() => void downloadExport("/v1/admin/herd/applications/export?format=json", "herd-applications.json").catch((error: unknown) => toast.error("Export failed", { description: describeError(error) }))}>JSON</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left font-tag text-[10px] uppercase text-ink-3">
                <th className="w-8 py-2"><span className="sr-only">Select</span></th>
                <th className="py-2">Wallet · X</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-right">Weight</th>
                <th className="py-2">Tasks</th>
                <th className="py-2">Flags</th>
                <th className="py-2"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <Row key={app.id} app={app} checked={selected.has(app.id)} onCheck={() => toggle(app.id)} open={open === app.id} onOpen={() => setOpen(open === app.id ? null : app.id)} />
              ))}
            </tbody>
          </table>
          {list.isLoading ? <p className="py-4 text-center text-[12px] text-ink-3">Loading…</p> : null}
          {list.data && rows.length === 0 ? <p className="py-6 text-center text-[12px] text-ink-3">No applications match.</p> : null}
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" size="xs" disabled={!cursor} onClick={() => setCursor(cursor && Number(cursor) > 50 ? String(Number(cursor) - 50) : undefined)}>← Previous</Button>
          <Button variant="ghost" size="xs" disabled={!list.data?.nextCursor} onClick={() => setCursor(list.data?.nextCursor ?? undefined)}>Next →</Button>
        </div>
      </Card>
    </section>
  );
}

function Row({ app, checked, onCheck, open, onOpen }: { readonly app: HerdApplication; readonly checked: boolean; readonly onCheck: () => void; readonly open: boolean; readonly onOpen: () => void }) {
  const admin = useHerdAdmin();
  const [text, setText] = useState("");
  const flags = app.flags.filter((flag) => flag.severity !== "info");
  const done = app.tasks.filter((task) => task.state === "submitted" || task.state === "verified").length;
  return (
    <>
      <tr className={cx("border-t border-dashed border-rule", checked && "bg-accent/10")}>
        <td className="py-2">
          <input type="checkbox" aria-label={`Select ${app.wallet}`} checked={checked} onChange={onCheck} />
        </td>
        <td className="py-2">
          <span className="font-mono text-ink">{short(app.wallet)}</span> <span className="text-ink-2">@{app.xHandle}</span>
          {app.attempts > 1 ? <Pill tone="mute" className="ml-1">re-applied</Pill> : null}
          {app.movedFrom ? <Pill tone="mute" className="ml-1">moved</Pill> : null}
        </td>
        <td className="py-2"><Pill tone={STATUS_TONE[app.status]}>{app.status}</Pill></td>
        <td className="py-2 text-right font-mono tnum">{app.score.score}</td>
        <td className="py-2 text-right font-mono tnum">{app.score.weight.toFixed(2)}×</td>
        <td className="py-2">{done}/{app.tasks.length}</td>
        <td className="py-2">
          {flags.length === 0 ? <span className="text-ink-3">—</span> : app.flagsCleared ? <Pill tone="mute">cleared</Pill> : flags.map((flag) => <Pill key={flag.code} tone={flag.severity === "high" ? "dn" : "warn"} className="mr-1">{flag.code}</Pill>)}
        </td>
        <td className="py-2 text-right">
          <Button variant="ghost" size="xs" aria-expanded={open} onClick={onOpen}>{open ? "Close" : "Open"}</Button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={8} className="bg-paper p-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <b className="font-tag text-[10px] uppercase text-ink-3">Tasks</b>
                <ul className="m-0 mt-1 list-none p-0 text-[12px]">
                  {app.tasks.map((task) => (
                    <li key={task.taskId} className="py-0.5">
                      <Pill tone={task.state === "verified" ? "up" : task.state === "failed" ? "dn" : task.state === "missing" ? "mute" : "acc"}>{task.state}</Pill>{" "}
                      {task.evidence?.startsWith("https://") ? <a className="break-all text-accent underline" href={task.evidence} target="_blank" rel="noreferrer noopener">{task.evidence}</a> : <span className="text-ink-2">{task.evidence ?? task.taskId}</span>}
                      {task.detail ? <span className="text-ink-3"> · {task.detail}</span> : null}
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" size="xs" onClick={() => void admin.verify.mutateAsync(app.id).catch((error: unknown) => toast.error("Not verified", { description: describeError(error) }))}>Verify with X API</Button>
              </div>
              <div>
                <b className="font-tag text-[10px] uppercase text-ink-3">Score {app.score.score}</b>
                <ul className="m-0 mt-1 list-none p-0 text-[11.5px] text-ink-2">
                  {app.score.components.map((component) => (
                    <li key={component.key}>{component.label}: {component.points}/{component.max} · {component.measure}</li>
                  ))}
                </ul>
                <b className="mt-2 block font-tag text-[10px] uppercase text-ink-3">Flags</b>
                <ul className="m-0 list-none p-0 text-[11.5px] text-ink-2">
                  {app.flags.map((flag) => <li key={flag.code}>{flag.severity}: {flag.detail}</li>)}
                  {app.flags.length === 0 ? <li>none</li> : null}
                </ul>
                {flags.length > 0 ? <Button variant="ghost" size="xs" onClick={() => void admin.flags.mutateAsync({ id: app.id, cleared: !app.flagsCleared })}>{app.flagsCleared ? "Restore flags" : "Clear flags (count weight again)"}</Button> : null}
              </div>
              <div>
                <b className="font-tag text-[10px] uppercase text-ink-3">Notes</b>
                <ul className="m-0 mt-1 list-none p-0 text-[11.5px] text-ink-2">
                  {app.notes.map((entry) => <li key={entry.at + entry.text}>{entry.at.slice(0, 16).replace("T", " ")} · {short(entry.by)}: {entry.text}</li>)}
                  {app.notes.length === 0 ? <li>none</li> : null}
                </ul>
                <div className="mt-1 flex gap-2">
                  <input aria-label="Add a note" value={text} onChange={(event) => setText(event.target.value)} className="h-8 min-w-0 flex-1 bg-card px-2 text-[12px] text-ink px-frame-thin" />
                  <Button variant="ink" size="xs" disabled={!text.trim()} onClick={() => void admin.note.mutateAsync({ id: app.id, text }).then(() => setText(""))}>Add</Button>
                </div>
                <p className="mt-2 text-[11px] text-ink-3">Applied {app.createdAt.slice(0, 16).replace("T", " ")} · ref {app.referral}{app.referredBy ? ` · referred by ${app.referredBy}` : ""}</p>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
