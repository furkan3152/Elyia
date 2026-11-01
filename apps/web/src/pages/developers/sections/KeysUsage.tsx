import type { ApiKeyScope, ApiKeyView } from "@elyia/core/api/developers";
import { MAX_KEYS_PER_DEVELOPER } from "@elyia/core/api/developers";
import { useEffect, useMemo, useState } from "react";

import { SessionBar } from "../../../features/session";
import { describeError } from "../../../lib/api";
import { useReducedMotion } from "../../../motion/useReducedMotion";
import { Button } from "../../../ui/Button";
import { copyText } from "../../../ui/clipboard";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Input } from "../../../ui/Input";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { toast } from "../../../ui/toast";
import { useDeveloperMe, useKeyActions, useKeys, useRegisterDeveloper, useUsage } from "../devApi";
import { ALL_SCOPES, dailySeries, formatCount, maskedKey, RANGE_DAYS, relativeTime, scopeChips, scrambleKey, shortDay, sortKeys, usageMeters, type UsageRange } from "../devModel";
import { Card, CardHead, Meter, Pill, SampleTag, SectionHead } from "../portal/ui";
import { SAMPLE_PLAIN_KEY, sampleKeys, sampleUsage } from "../sample";
import { UsageBars } from "../UsageBars";
import type { DevAccess } from "../access";

const SCOPE_TEXT: Readonly<Record<ApiKeyScope, string>> = { read: "read", plan: "plan", "execute-prepare": "prepare", webhooks: "webhooks" };

/** The plain key, once: it scrambles into place, then stays until dismissed. Never stored. */
function KeyReveal({ plainKey, sample, onDone }: { readonly plainKey: string; readonly sample: boolean; readonly onDone?: () => void }) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState<{ readonly key: string; readonly shown: string }>(() => ({ key: plainKey, shown: scrambleKey(plainKey, 0, 0) }));
  useEffect(() => {
    if (reduced) return undefined;
    const started = performance.now();
    let handle = 0;
    const step = () => {
      const elapsed = (performance.now() - started) / 1000;
      const progress = (elapsed - 0.3) / 1.6;
      setFrame({ key: plainKey, shown: scrambleKey(plainKey, progress, Math.floor(elapsed * 12)) });
      if (progress < 1) handle = window.setTimeout(step, 83);
    };
    handle = window.setTimeout(step, 83);
    return () => window.clearTimeout(handle);
  }, [plainKey, reduced]);
  const shown = reduced ? plainKey : frame.key === plainKey ? frame.shown : scrambleKey(plainKey, 0, 0);
  return (
    <div className="mt-4 bg-signal/20 p-3 px-frame-thin px-tone-signal">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-tag text-[10px] uppercase tracking-[0.06em] text-ink">New key · shown once · hashed at rest</span>
        {sample ? <SampleTag>Sample</SampleTag> : null}
      </div>
      <div className="flex items-center gap-2.5">
        <code aria-label={sample ? "Sample key" : "Your new API key"} className="min-w-0 flex-1 truncate bg-card px-3 py-2 font-mono text-[12.5px] text-ink px-frame-thin">
          {shown}
        </code>
        <Button
          variant="ink"
          size="sm"
          disabled={sample}
          onClick={() => void copyText(plainKey).then((ok) => (ok ? toast.success("Key copied", { description: "Store it in your secrets manager now; Elyia cannot show it again." }) : toast.error("Copy failed: select the key instead")))}
        >
          Copy
        </Button>
      </div>
      {onDone ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11.5px] text-ink-2">Elyia keeps only its SHA-256. Lose it and you rotate.</span>
          <Button variant="ghost" size="xs" onClick={onDone}>
            I saved it
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ScopeChip({ children, muted = false }: { readonly children: React.ReactNode; readonly muted?: boolean }) {
  return <span className={cx("inline-block bg-paper-2 px-1.5 py-[2px] font-tag text-[9.5px] uppercase leading-none px-frame-thin", muted ? "text-ink-3" : "text-ink-2")}>{children}</span>;
}

function KeyRow({ apiKey, now, live, onRotate, onRevoke, busy }: { readonly apiKey: ApiKeyView; readonly now: number; readonly live: boolean; readonly onRotate: () => void; readonly onRevoke: () => void; readonly busy: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const revoked = apiKey.revokedAt !== null;
  return (
    <tr className="border-t-2 border-dashed border-rule align-middle">
      <td className={cx("py-2.5 pr-3 text-[12.5px]", revoked ? "text-ink-3" : "font-bold text-ink")}>{apiKey.name}</td>
      <td className={cx("py-2.5 pr-3 font-mono text-[12px] tnum", revoked ? "text-ink-3" : "text-ink-2")}>{maskedKey(apiKey)}</td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap gap-1">{revoked ? <Pill tone="dn">revoked</Pill> : scopeChips(apiKey.scopes).map((chip) => <ScopeChip key={chip}>{chip}</ScopeChip>)}</div>
      </td>
      <td className="py-2.5 pr-3 text-right text-[12px] text-ink-3">{relativeTime(apiKey.revokedAt ?? apiKey.lastUsedAt, now)}</td>
      <td className="py-2.5 text-right">
        {live && !revoked ? (
          confirm ? (
            <span className="inline-flex items-center gap-1">
              <Button variant="danger" size="xs" loading={busy} onClick={onRevoke} aria-label={`Confirm revoking ${apiKey.name}`}>
                Revoke
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirm(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Button variant="ink" size="xs" disabled={busy} onClick={onRotate} aria-label={`Rotate ${apiKey.name}`}>
                Rotate
              </Button>
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => setConfirm(true)} aria-label={`Revoke ${apiKey.name}`}>
                Revoke…
              </Button>
            </span>
          )
        ) : null}
      </td>
    </tr>
  );
}

function CreateKeyForm({ onCreate, busy, onCancel }: { readonly onCreate: (name: string, scopes: ApiKeyScope[]) => void; readonly busy: boolean; readonly onCancel: () => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["read", "plan"]);
  const toggle = (scope: ApiKeyScope) => setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  return (
    <form
      className="mb-4 flex flex-col gap-3 bg-paper p-3 px-frame-thin"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && scopes.length > 0) onCreate(name.trim(), scopes);
      }}
    >
      <Input label="Key name" value={name} maxLength={60} placeholder="Production" onChange={(event) => setName(event.target.value)} size="sm" autoFocus />
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1.5 font-tag text-[10px] uppercase tracking-[0.06em] text-ink-2">Scopes</legend>
        <div className="flex flex-wrap gap-2">
          {ALL_SCOPES.map((scope) => (
            <button key={scope} type="button" aria-pressed={scopes.includes(scope)} onClick={() => toggle(scope)} className={cx("px-2 py-1 font-tag text-[10px] uppercase px-frame-thin", scopes.includes(scope) ? "bg-accent text-accent-ink" : "bg-card text-ink-2", FOCUS_RING)}>
              {scopes.includes(scope) ? "✓ " : ""}
              {SCOPE_TEXT[scope]}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-[11.5px] text-ink-3">Keys plan and prepare unsigned payloads. No key can sign or move funds.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" loading={busy} disabled={!name.trim() || scopes.length === 0}>
          Create key
        </Button>
      </div>
    </form>
  );
}

function RegisterPanel() {
  const register = useRegisterDeveloper();
  const [name, setName] = useState("");
  return (
    <form
      className="mt-4 flex flex-col gap-3 bg-paper p-4 px-frame-thin"
      onSubmit={(event) => {
        event.preventDefault();
        register.mutate(name.trim(), { onError: (error) => toast.error("Could not register", { description: describeError(error) }) });
      }}
    >
      <p className="text-[12.5px] text-ink-2">You are signed in. Name your project to open a developer profile; keys, webhooks and your fee live under it.</p>
      <Input label="Project name" value={name} maxLength={60} placeholder="Acme Wallet" onChange={(event) => setName(event.target.value)} size="sm" />
      <Button variant="primary" size="sm" type="submit" loading={register.isPending} className="portal-pulse self-center">
        Open my developer profile
      </Button>
    </form>
  );
}

function KeysCard({ access, now }: { readonly access: DevAccess; readonly now: number }) {
  const live = access === "developer";
  const keys = useKeys();
  const { create, rotate, revoke } = useKeyActions();
  const [creating, setCreating] = useState(false);
  const [plain, setPlain] = useState<string | null>(null);
  const rows = useMemo(() => sortKeys(live ? (keys.data?.keys ?? []) : sampleKeys(now)), [live, keys.data, now]);
  const active = rows.filter((row) => row.revokedAt === null).length;

  const onCreate = (name: string, scopes: ApiKeyScope[]) =>
    create.mutate(
      { name, scopes },
      {
        onSuccess: (response) => {
          setPlain(response.plainKey);
          setCreating(false);
        },
        onError: (error) => toast.error("Key not created", { description: describeError(error) }),
      },
    );

  return (
    <Card className="flex flex-col">
      <CardHead
        glyph="key"
        title="API keys"
        right={
          live ? (
            <Button variant="primary" size="sm" disabled={creating || active >= MAX_KEYS_PER_DEVELOPER} onClick={() => setCreating(true)}>
              ＋ Create key
            </Button>
          ) : (
            <SampleTag />
          )
        }
      />
      {live && creating ? <CreateKeyForm onCreate={onCreate} busy={create.isPending} onCancel={() => setCreating(false)} /> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] border-collapse">
          <caption className="sr-only">{live ? "Your API keys" : "Sample API keys"}</caption>
          <thead>
            <tr className="text-left font-tag text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
              <th className="pb-2 pr-3 font-normal">Name</th>
              <th className="pb-2 pr-3 font-normal">Key</th>
              <th className="pb-2 pr-3 font-normal">Scopes</th>
              <th className="pb-2 pr-3 text-right font-normal">Last used</th>
              <th className="pb-2 text-right font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <KeyRow
                key={row.id}
                apiKey={row}
                now={now}
                live={live}
                busy={rotate.isPending || revoke.isPending}
                onRotate={() => rotate.mutate(row.id, { onSuccess: (response) => setPlain(response.plainKey), onError: (error) => toast.error("Rotation failed", { description: describeError(error) }) })}
                onRevoke={() => revoke.mutate(row.id, { onSuccess: () => toast.success(`${row.name} revoked`, { description: "Requests with it now answer 401." }), onError: (error) => toast.error("Revoke failed", { description: describeError(error) }) })}
              />
            ))}
            {live && rows.length === 0 && !keys.isLoading ? (
              <tr>
                <td colSpan={5} className="border-t-2 border-dashed border-rule py-4 text-center text-[12.5px] text-ink-3">
                  No keys yet. Create one; it is shown once.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {keys.isError && live ? <p className="mt-2 text-[12px] text-down">Keys did not load: {describeError(keys.error)}</p> : null}
      {live ? plain ? <KeyReveal plainKey={plain} sample={false} onDone={() => setPlain(null)} /> : null : <KeyReveal plainKey={SAMPLE_PLAIN_KEY} sample />}
      {access === "user" ? <RegisterPanel /> : null}
      {access === "anonymous" ? (
        <div className="mt-4 bg-paper p-4 px-frame-thin">
          <SessionBar purpose="manage your API keys" variant="panel" />
        </div>
      ) : null}
    </Card>
  );
}

function UsageCard({ access, now }: { readonly access: DevAccess; readonly now: number }) {
  const [range, setRange] = useState<UsageRange>("24h");
  const live = access === "developer";
  const usage = useUsage(30);
  const data = live && usage.data ? usage.data : sampleUsage(now);
  const days = RANGE_DAYS[range];
  const meters = usageMeters(data, days);
  const series = dailySeries(data, 14);
  return (
    <Card className="flex flex-col">
      <CardHead
        glyph="pulse"
        title={range === "24h" ? "Usage today" : `Usage · ${range}`}
        right={
          <SegmentedControl
            label="Usage range"
            size="sm"
            value={range}
            onChange={setRange}
            options={[
              { value: "24h", label: "24 h" },
              { value: "7d", label: "7 d" },
              { value: "30d", label: "30 d" },
            ]}
          />
        }
      />
      <div className="flex flex-col gap-4">
        {meters.map((meter) => (
          <div key={meter.metric}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-ink">
                {meter.label}
                {meter.hot ? <span className="ml-2 font-tag text-[10px] uppercase text-warn-ink">near quota</span> : null}
              </span>
              <span className="font-mono text-ink-2 tnum">
                {formatCount(meter.used)} / {formatCount(meter.quota)}
              </span>
            </div>
            <Meter fraction={meter.fraction} label={`${meter.label}: ${formatCount(meter.used)} of ${formatCount(meter.quota)}`} />
          </div>
        ))}
      </div>
      <div className="mt-auto pt-5">
        <UsageBars values={series.map((point) => point.value)} label={`Plans per day, last ${series.length} days${live ? "" : " (sample)"}`} />
        <div className="mt-1.5 flex justify-between font-tag text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
          <span>{series[0] ? shortDay(series[0].day) : ""}</span>
          <span>plans / day{live ? "" : " · sample"}</span>
          <span>Today</span>
        </div>
      </div>
      {live && usage.isError ? <p className="mt-2 text-[12px] text-down">Usage did not load: {describeError(usage.error)}</p> : null}
    </Card>
  );
}

export function KeysUsage({ access, now }: { readonly access: DevAccess; readonly now: number }) {
  const me = useDeveloperMe();
  const project = me.data?.profile.name ?? (access === "developer" ? "your project" : "sample project");
  return (
    <section id="keys" aria-labelledby="keys-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="keys-title" tag={`Your project · ${project}`} title="Keys and usage." />
      <div id="usage" className="grid scroll-mt-28 grid-cols-1 gap-6 md:grid-cols-2">
        <KeysCard access={access} now={now} />
        <UsageCard access={access} now={now} />
      </div>
    </section>
  );
}
