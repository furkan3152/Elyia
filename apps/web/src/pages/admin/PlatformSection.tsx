import { FEATURE_FLAGS, type DeploymentRecord, type FeatureFlag } from "@elyia/core/api/admin";

import { describeError } from "../../lib/api";
import { cx } from "../../ui/cx";
import { toast } from "../../ui/toast";
import { Toggle } from "../../ui/Toggle";
import { Card, CardHead, Pill, SectionHead, Stat } from "../developers/portal/ui";
import { useFlags, useHealth, useSetFlag, useSystem, useTelegramStatus } from "./adminApi";
import { MiniBaro } from "./AdminCanvases";
import { shortHex } from "./deployModel";

const FLAG_TEXT: Readonly<Record<FeatureFlag, { readonly name: string; readonly note: string }>> = {
  elyiaRouterVenue: { name: "venue.elyia-router", note: "the router joins the auction" },
  agentLlm: { name: "agent.chat", note: "Ely chat with tools" },
  keeper: { name: "agent.keeper", note: "bounded keeper · caps required" },
  telegram: { name: "ops.telegram", note: "alerts and the Mini App" },
  webhooks: { name: "dev.webhooks", note: "signed deliveries" },
  mcp: { name: "dev.mcp", note: "tools for agents" },
  alerts: { name: "ops.alerts", note: "price, funding, rope distance" },
};

const NETWORK_LABEL: Readonly<Record<string, string>> = { "elysium-testnet": "Elysium RPC · 99801", "hyperevm-testnet": "HyperEVM RPC · 998", "hypercore-testnet": "HyperCore API", "elysium-mainnet": "Elysium RPC · 99901", "hyperevm-mainnet": "HyperEVM RPC · 999", "hypercore-mainnet": "HyperCore API" };

interface Row {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly value: string;
  readonly samples: readonly number[];
}

export function PlatformSection({ deployments }: { readonly deployments: readonly DeploymentRecord[] }) {
  const flags = useFlags(true);
  const setFlag = useSetFlag();
  const system = useSystem(true);
  const healthQuery = useHealth(true);
  const health = { ...healthQuery, data: healthQuery.data?.health };
  const history = healthQuery.data?.samples ?? {};
  const agentMode = system.data?.agent.mode;
  const telegram = useTelegramStatus(true);

  const deps = health.data?.dependencies;
  const base = [
    { id: "api", label: "API · v1", ok: health.data?.status === "ok", value: health.data ? `${history.api?.at(-1) ?? "?"} ms · up ${Math.floor((health.data.uptimeSeconds ?? 0) / 60)} min` : "no answer" },
    { id: "store", label: `Store · ${deps?.store?.kind ?? "?"}`, ok: Boolean(deps?.store?.ok), value: deps?.store ? `${deps.store.latencyMs ?? "?"} ms` : "—" },
    ...(deps?.networks ?? []).map((net) => ({ id: net.network, label: NETWORK_LABEL[net.network] ?? net.network, ok: net.reachable, value: net.reachable ? `${net.latencyMs ?? "?"} ms` : "unreachable" })),
  ];
  const queues = Object.entries(system.data?.queues ?? {});
  const rows: Row[] = [
    ...base.map((row) => ({ id: row.id, label: row.label, ok: row.ok, value: row.value, samples: history[row.id] ?? [] })),
    ...queues.slice(0, 3).map(([name, queue]) => ({ id: `q-${name}`, label: `Queue · ${name}`, ok: !system.data?.workers[name]?.lastError, value: `${queue.pending} queued`, samples: [] })),
  ];
  const allUp = rows.length > 0 && rows.every((row) => row.ok);
  const usage = system.data?.usage;

  return (
    <>
      <section id="flags" aria-labelledby="flags-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
        <SectionHead id="flags-title" tag="Platform" title="Flags and health." />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="flex flex-col">
            <CardHead glyph="grid" title="Feature flags" right={<Pill tone="mute">{FEATURE_FLAGS.length}</Pill>} />
            <ul className="m-0 flex list-none flex-col p-0">
              {FEATURE_FLAGS.map((flag, index) => {
                const on = flags.data?.flags[flag] ?? false;
                const note =
                  flag === "agentLlm" && agentMode === "deterministic"
                    ? "on · no model key: deterministic replies"
                    : flag === "telegram" && telegram.data
                      ? `${telegram.data.note}${telegram.data.linkedWallets > 0 ? ` · ${telegram.data.linkedWallets} linked` : ""}`
                      : FLAG_TEXT[flag].note;
                return (
                  <li key={flag} className={cx("flex items-center justify-between gap-3 py-2.5", index > 0 && "border-t-2 border-dashed border-rule")}>
                    <Toggle
                      checked={on}
                      disabled={!flags.data || setFlag.isPending}
                      label={<span className="font-mono normal-case text-[12.5px] font-bold">{FLAG_TEXT[flag].name}</span>}
                      description={note}
                      onChange={(next) => setFlag.mutate({ flag, on: next }, { onSuccess: () => toast.success(`${FLAG_TEXT[flag].name} ${next ? "on" : "off"}`), onError: (error) => toast.error("Flag not changed", { description: describeError(error) }) })}
                    />
                    <span className={cx("font-tag text-[10px] uppercase", on ? "text-up" : "text-ink-3")}>{on ? "on" : "off"}</span>
                  </li>
                );
              })}
            </ul>
            {flags.data?.updatedBy ? <p className="mt-auto pt-3 text-[11px] text-ink-3">Last change by {shortHex(flags.data.updatedBy)} · {flags.data.updatedAt?.slice(0, 16).replace("T", " ")} UTC</p> : null}
            {flags.isError ? <p className="text-[12px] text-down">{describeError(flags.error)}</p> : null}
          </Card>
          <Card id="health" className="flex scroll-mt-28 flex-col">
            <CardHead glyph="pulse" title="System health" right={health.isError ? <Pill tone="dn" dot>API down</Pill> : allUp ? <Pill tone="up" dot>All up</Pill> : <Pill tone="warn" dot>Degraded</Pill>} />
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[12px]">
              {rows.map((row) => (
                <li key={row.id} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[10px_minmax(0,1fr)_auto_84px]">
                  <span aria-hidden="true" className={cx("h-[8px] w-[8px]", row.ok ? "bg-up" : "bg-warn")} />
                  <span className="truncate text-ink">{row.label}</span>
                  <span className="hidden sm:block">
                    <MiniBaro samples={row.samples} warnAbove={800} label={`${row.label} latency, recent samples`} />
                  </span>
                  <span className={cx("text-right font-mono tnum", row.ok ? "text-ink-2" : "text-warn-ink")}>{row.ok ? row.value : `warn · ${row.value}`}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-3 text-[11px] text-ink-3">Barographs sample /v1/health every 15 s while this page is open.</p>
          </Card>
        </div>
      </section>
      <section id="usage" aria-labelledby="usage-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
        <SectionHead id="usage-title" tag={`Usage · ${usage?.day ?? "today"} UTC · keyed requests`} title="Who is climbing." />
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          <Stat label="Requests" value={usage ? usage.requests.toLocaleString("en-US") : "—"} note="with a developer key" />
          <Stat label="Plans" value={usage ? usage.plans.toLocaleString("en-US") : "—"} note={usage && usage.requests > 0 ? `${Math.round((usage.plans / usage.requests) * 100)}% of requests` : "today"} />
          <Stat label="Prepares" value={usage ? usage.prepares.toLocaleString("en-US") : "—"} note="unsigned txs handed out" />
          <Stat label="Developer keys" value={usage ? usage.keys.toLocaleString("en-US") : "—"} note={usage ? `${usage.developers} project${usage.developers === 1 ? "" : "s"}` : "—"} />
        </div>
        {system.isError ? <p className="mt-3 text-center text-[12px] text-down">{describeError(system.error)}</p> : null}
      </section>
      <section id="audit" aria-labelledby="audit-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
        <SectionHead id="audit-title" tag="Audit log" title="What landed, and who recorded it." />
        <Card>
          {deployments.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-ink-3">No deployments recorded yet. The first one appears here after camp 5.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[12px]">
                <thead>
                  <tr className="text-left font-tag text-[9.5px] uppercase tracking-[0.06em] text-ink-3">
                    <th className="pb-2 pr-3 font-normal">When (UTC)</th>
                    <th className="pb-2 pr-3 font-normal">Contract</th>
                    <th className="pb-2 pr-3 font-normal">Network</th>
                    <th className="pb-2 pr-3 font-normal">Address</th>
                    <th className="pb-2 pr-3 font-normal">Checks</th>
                    <th className="pb-2 font-normal">By</th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((record) => {
                    const checks = Object.values(record.checks).filter((value) => value === true).length;
                    return (
                      <tr key={`${record.network}-${record.contract}-${record.txHash}`} className="border-t-2 border-dashed border-rule">
                        <td className="py-2 pr-3 font-mono text-ink-2">{record.recordedAt.slice(0, 16).replace("T", " ")}</td>
                        <td className="py-2 pr-3 font-bold text-ink">{record.contract}</td>
                        <td className="py-2 pr-3 text-ink-2">{record.network}</td>
                        <td className="py-2 pr-3 font-mono text-ink">{shortHex(record.address)}</td>
                        <td className={cx("py-2 pr-3", record.checks.runtimeCodeMatches ? "text-up" : "text-down")}>{checks} / 5 ✓</td>
                        <td className="py-2 font-mono text-ink-2">{shortHex(record.recordedBy)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
