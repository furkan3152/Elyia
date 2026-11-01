import { MAX_INTEGRATOR_FEE_BPS, WEBHOOK_EVENT_TYPES, type WebhookEventType, type WebhookView } from "@elyia/core/api/developers";
import { useState } from "react";

import { describeError } from "../../../lib/api";
import { Ely } from "../../../pixel/Ely";
import { Button } from "../../../ui/Button";
import { copyText } from "../../../ui/clipboard";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Input } from "../../../ui/Input";
import { toast } from "../../../ui/toast";
import type { DevAccess } from "../access";
import { useDeliveries, useDeveloperMe, useSaveFee, useWebhookActions, useWebhooks } from "../devApi";
import { bpsToPercent, clampBps, deliveryLine, feeDisclosure, relativeTime, shortEvent, webhookUrlProblem, widgetSnippet } from "../devModel";
import { Card, CardHead, KV, Pill, SampleTag, SectionHead } from "../portal/ui";
import { sampleDeliveries, sampleWebhook } from "../sample";
import { shortAddress } from "../../../features/session";

function EventChip({ type, on, onToggle, disabled }: { readonly type: WebhookEventType; readonly on: boolean; readonly onToggle?: () => void; readonly disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled || !onToggle}
      onClick={onToggle}
      className={cx("px-2 py-1 font-tag text-[9.5px] uppercase leading-none px-frame-thin disabled:cursor-default", on ? "bg-accent/15 text-accent px-tone-accent" : "bg-paper text-ink-3", FOCUS_RING)}
    >
      {on ? "✓ " : ""}
      {shortEvent(type)}
    </button>
  );
}

function NewWebhookForm() {
  const { create } = useWebhookActions();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>(["intent.step.settled", "intent.failed"]);
  const [secret, setSecret] = useState<string | null>(null);
  const problem = url ? webhookUrlProblem(url) : null;
  if (secret) {
    return (
      <div className="bg-signal/20 p-3 px-frame-thin px-tone-signal">
        <div className="mb-1.5 font-tag text-[10px] uppercase text-ink">Signing secret · shown once</div>
        <code className="block truncate bg-card px-2 py-1.5 font-mono text-[12px] text-ink px-frame-thin">{secret}</code>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ink" size="xs" onClick={() => void copyText(secret).then((ok) => (ok ? toast.success("Secret copied") : toast.error("Copy failed")))}>
            Copy
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSecret(null)}>
            I saved it
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem || !url) return;
        create.mutate({ url: url.trim(), events }, { onSuccess: (response) => setSecret(response.secret), onError: (error) => toast.error("Webhook not added", { description: describeError(error) }) });
      }}
    >
      <Input label="Receiver URL" size="sm" mono value={url} placeholder="https://your-app.example/hooks/elyia" onChange={(event) => setUrl(event.target.value)} error={problem ?? undefined} />
      <div className="flex flex-wrap gap-1.5">
        {WEBHOOK_EVENT_TYPES.map((type) => (
          <EventChip key={type} type={type} on={events.includes(type)} onToggle={() => setEvents((list) => (list.includes(type) ? list.filter((t) => t !== type) : [...list, type]))} />
        ))}
      </div>
      <Button variant="primary" size="sm" type="submit" loading={create.isPending} disabled={!url || Boolean(problem) || events.length === 0}>
        Add webhook
      </Button>
    </form>
  );
}

function WebhooksCard({ access, now }: { readonly access: DevAccess; readonly now: number }) {
  const live = access === "developer";
  const list = useWebhooks();
  const hook: WebhookView | null = live ? (list.data?.webhooks[0] ?? null) : sampleWebhook(now);
  const deliveries = useDeliveries(live ? (hook?.id ?? null) : null);
  const { test, update } = useWebhookActions();
  const rows = live ? (deliveries.data?.deliveries ?? []) : sampleDeliveries(now);
  return (
    <Card className="flex flex-col gap-3">
      <CardHead
        glyph="hook"
        title="Webhooks"
        right={
          live ? (
            hook ? (
              <Button variant="ink" size="xs" loading={test.isPending} onClick={() => test.mutate(hook.id, { onSuccess: (response) => toast.info("Test delivery sent", { description: deliveryLine(response.delivery).text }), onError: (error) => toast.error("Test fire failed", { description: describeError(error) }) })}>
                Test fire
              </Button>
            ) : null
          ) : (
            <SampleTag />
          )
        }
      />
      {live && !hook && !list.isLoading ? (
        <NewWebhookForm />
      ) : hook ? (
        <>
          <div className="truncate bg-paper px-2.5 py-2 font-mono text-[11.5px] text-ink px-frame-thin" title={hook.url}>
            {hook.url}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEBHOOK_EVENT_TYPES.map((type) => {
              const on = hook.events.includes(type);
              const next = on ? hook.events.filter((t) => t !== type) : [...hook.events, type];
              return <EventChip key={type} type={type} on={on} disabled={!live || update.isPending || next.length === 0} onToggle={live ? () => update.mutate({ id: hook.id, events: next }) : undefined} />;
            })}
          </div>
          <div className="mt-1 flex items-center justify-between font-tag text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
            <span>Deliveries · HMAC signed</span>
            <span>secret …{hook.secretLast4}</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[11.5px]">
            {rows.slice(0, 4).map((row) => {
              const line = deliveryLine(row);
              return (
                <li key={row.id} className="portal-stepin flex items-center justify-between gap-2 bg-paper px-2 py-1.5 px-frame-thin">
                  <span className="min-w-0 truncate text-ink">
                    {shortEvent(row.eventType)} · <span className="text-ink-3">{relativeTime(row.at, now)}</span>
                  </span>
                  <span className={cx("shrink-0 font-mono tnum", line.tone === "up" ? "text-up" : line.tone === "warn" ? "text-warn-ink" : "text-down")}>{line.text}</span>
                </li>
              );
            })}
            {live && rows.length === 0 ? <li className="py-2 text-center text-ink-3">No deliveries yet. Test fire sends a signed `webhook.test`.</li> : null}
          </ul>
        </>
      ) : null}
      {live && list.isError ? <p className="text-[12px] text-down">Webhooks did not load: {describeError(list.error)}</p> : null}
      <p className="mt-auto text-[11px] leading-relaxed text-ink-3">Verify `Elyia-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`; refuse anything older than 5 min. Retries at 1 s, 5 s, 25 s, 125 s.</p>
    </Card>
  );
}

function WidgetCard({ access, feeBps }: { readonly access: DevAccess; readonly feeBps: number }) {
  const me = useDeveloperMe();
  const widget = access === "developer" ? (me.data?.widget ?? null) : null;
  const snippet = widgetSnippet(widget?.developerId ?? null);
  return (
    <Card id="widget" className="flex scroll-mt-28 flex-col gap-3">
      <CardHead glyph="widget" title="Widget" right={widget ? <Pill tone="mute">{widget.allowedOrigins.length} origin{widget.allowedOrigins.length === 1 ? "" : "s"}</Pill> : <Pill tone="mute">preview</Pill>} />
      <div className="flex flex-col items-center gap-2 bg-paper p-4 text-center px-frame-thin">
        <Ely state="idle" size={56} label="Ely in the widget" />
        <b className="font-display text-[20px] text-ink">Where to?</b>
        <div className="w-full bg-card px-2.5 py-2 text-left text-[11.5px] text-ink-3 px-frame-thin">bridge 20 HYPE to Elysium…</div>
        <Button variant="primary" size="sm" fullWidth disabled title="Preview">
          Plan route
        </Button>
        <span className="font-tag text-[9.5px] uppercase text-ink-3">Powered by Elyia · fee {bpsToPercent(feeBps)}</span>
      </div>
      <pre className="m-0 overflow-x-auto bg-[#16201B] px-3 py-2.5 font-mono text-[11px] text-[#CFEFF3]">{snippet}</pre>
      <p className="mt-auto text-[11px] leading-relaxed text-ink-3">
        The config is live at <code className="text-ink-2">GET /v1/widget/{widget?.developerId ?? ":developerId"}</code>; the hosted embed script is not published yet.
      </p>
    </Card>
  );
}

function FeeCard({ access, feeBps, setFeeBps, project }: { readonly access: DevAccess; readonly feeBps: number; readonly setFeeBps: (bps: number) => void; readonly project: string }) {
  const live = access === "developer";
  const me = useDeveloperMe();
  const save = useSaveFee();
  const saved = me.data?.fee ?? null;
  const [recipient, setRecipient] = useState<string | null>(null);
  const recipientValue = recipient ?? saved?.recipient ?? "";
  const recipientOk = recipientValue === "" || /^0x[0-9a-fA-F]{40}$/u.test(recipientValue);
  const dirty = live && saved !== null && (saved.feeBps !== feeBps || (saved.recipient ?? "") !== recipientValue);
  return (
    <Card id="fee" className="flex scroll-mt-28 flex-col gap-3">
      <CardHead glyph="percent" title="Your fee" right={feeBps > 0 ? <Pill tone="up">earning</Pill> : <Pill tone="mute">off</Pill>} />
      <div className="text-center">
        <span className="font-display text-[52px] font-bold leading-none text-ink tnum">{feeBps}</span>
        <span className="font-display text-[20px] text-ink"> bps</span>
        <div className="mt-1 font-tag text-[10px] uppercase tracking-[0.06em] text-ink-3">
          = {bpsToPercent(feeBps)} · cap {MAX_INTEGRATOR_FEE_BPS} bps
        </div>
      </div>
      <input
        type="range"
        className="portal-range"
        min={0}
        max={MAX_INTEGRATOR_FEE_BPS}
        step={1}
        value={feeBps}
        onChange={(event) => setFeeBps(clampBps(Number(event.target.value), MAX_INTEGRATOR_FEE_BPS))}
        aria-label="Integrator fee in basis points"
        aria-valuetext={`${feeBps} basis points, ${bpsToPercent(feeBps)}`}
      />
      <div className="bg-paper px-3 py-2.5 text-[12px] text-ink-2 px-frame-thin">
        Users see: <b className="text-ink">“{feeDisclosure(feeBps, project)}”</b> on every route card.
      </div>
      {live ? <Input label="Recipient" size="sm" mono value={recipientValue} placeholder="0x… (your treasury)" onChange={(event) => setRecipient(event.target.value.trim())} error={recipientOk ? undefined : "A 0x address, 40 hex characters."} /> : null}
      <KV
        rows={[
          ["Paid by", "ElyiaRouter, same tx"],
          ["Recipient", live ? (recipientValue ? shortAddress(recipientValue) : "not set: no fee is paid") : "set after sign-in"],
          ["Disclosed", "on every route card, EN + TR"],
        ]}
      />
      {live ? (
        <Button
          variant="primary"
          size="sm"
          className="mt-auto"
          disabled={!dirty || !recipientOk || (feeBps > 0 && !recipientValue)}
          loading={save.isPending}
          onClick={() => save.mutate({ feeBps, recipient: recipientValue || null }, { onSuccess: () => toast.success(`Fee saved: ${feeBps} bps`), onError: (error) => toast.error("Fee not saved", { description: describeError(error) }) })}
        >
          {feeBps > 0 && !recipientValue ? "Set a recipient to save" : dirty ? `Save ${feeBps} bps` : "Saved"}
        </Button>
      ) : (
        <p className="mt-auto text-[11px] text-ink-3">Preview only. Sign in to set your fee; the API refuses anything above {MAX_INTEGRATOR_FEE_BPS} bps and the router enforces its own cap on chain.</p>
      )}
    </Card>
  );
}

export function ShipIt({ access, now, feeBps, setFeeBps, project }: { readonly access: DevAccess; readonly now: number; readonly feeBps: number; readonly setFeeBps: (bps: number) => void; readonly project: string }) {
  return (
    <section id="webhooks" aria-labelledby="ship-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="ship-title" tag="Ship it" title="Webhooks, widget, your fee." />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <WebhooksCard access={access} now={now} />
        <WidgetCard access={access} feeBps={feeBps} />
        <FeeCard access={access} feeBps={feeBps} setFeeBps={setFeeBps} project={project} />
      </div>
    </section>
  );
}
