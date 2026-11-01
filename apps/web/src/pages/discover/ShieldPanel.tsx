import type { ShieldReport as ApiShieldReport } from "@elyia/core/api/discovery";
import { assessToken, flaggedTokensFor, tokensFor } from "@elyia/core/assets";
import { NETWORKS, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { mediaMatches, subscribeMedia } from "../../app/state/media";

import { Split } from "../../pixel/layout";
import { ConditionSign } from "../../topo/ConditionSign";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { ShieldSign } from "./ShieldSign";
import { apiGet } from "../../lib/api";
import { factsFrom, shieldCalls, shieldFromApi, shieldReport, type CheckResult, type RawAnswer, type ShieldReport } from "./shield";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const NETWORKS_BY_MODE: Readonly<Record<NetworkEnvironment, readonly NetworkKey[]>> = {
  testnet: ["elysium-testnet", "hyperevm-testnet"],
  mainnet: ["hyperevm-mainnet"],
};
const LAYER_WORD: Partial<Record<NetworkKey, string>> = { "elysium-testnet": "Summit · Elysium", "elysium-mainnet": "Summit · Elysium", "hyperevm-testnet": "Ridge · HyperEVM", "hyperevm-mainnet": "Ridge · HyperEVM" };
const MARK: Readonly<Record<CheckResult, { readonly glyph: string; readonly tone: string; readonly word: string }>> = {
  pass: { glyph: "▲", tone: "text-up", word: "pass" },
  warn: { glyph: "◆", tone: "text-warn-ink", word: "caution" },
  fail: { glyph: "▼", tone: "text-down", word: "fail" },
  unknown: { glyph: "○", tone: "text-ink-3", word: "not checked" },
};

/** Under md the Split stacks: the same width where the Shield reorders its cards. */
const NARROW = "(max-width: 767px)";

function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(NARROW, onChange),
    () => mediaMatches(NARROW) ?? false,
    () => false,
  );
}

/** One batched JSON-RPC round trip; a reverted call answers null instead of failing the batch. */
async function readAnswers(network: NetworkKey, address: string, signal: AbortSignal): Promise<RawAnswer[]> {
  const chain = NETWORKS[network];
  const urls = chain.vm === "evm" ? chain.rpcUrls : [];
  const calls = shieldCalls(address);
  let lastError: unknown = new Error("No public RPC for this network yet.");
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, method: call.method, params: call.params }))),
        credentials: "omit",
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      const items = Array.isArray(body) ? body : [body];
      const byId = new Map<number, RawAnswer>();
      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const record = item as { id?: unknown; result?: unknown };
        if (typeof record.id === "number") byId.set(record.id, typeof record.result === "string" ? record.result : null);
      }
      if (byId.size === 0) throw new Error("empty answer");
      return calls.map((_, index) => byId.get(index + 1) ?? null);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

type State = { readonly kind: "idle" } | { readonly kind: "reading" } | { readonly kind: "done"; readonly report: ShieldReport; readonly address: string; readonly network: NetworkKey; readonly at: number; readonly source: "api" | "browser" } | { readonly kind: "error"; readonly message: string };

/**
 * Shield: paste a token, get its route condition. Runs in the browser
 * against the public RPC and Elyia's verified list; says which
 * checks need the discovery API and were not run.
 */
export function ShieldPanel({ mode }: { readonly mode: NetworkEnvironment }) {
  const id = useId();
  const narrow = useNarrow();
  const networks = NETWORKS_BY_MODE[mode];
  const [network, setNetwork] = useState<NetworkKey>(networks[0]!);
  const [value, setValue] = useState(() => tokensFor(networks[0]!).find((token) => token.address !== null)?.address ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const examples = useMemo(() => tokensFor(network).filter((token) => token.address !== null).slice(0, 3), [network]);
  const flagged = useMemo(() => flaggedTokensFor(network), [network]);
  const lookalike = flagged.find((row) => row.standard === "erc20" && row.tags.includes("lookalike")) ?? null;

  // Open on a real reading: the first verified token of the network, checked live.
  const first = examples[0]?.address ?? null;
  useEffect(() => {
    if (!first) return undefined;
    void run(first, network);
    return () => controller.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function run(raw: string, on: NetworkKey) {
    const address = raw.trim();
    if (!ADDRESS.test(address)) {
      setInputError("That is not a token address: 0x followed by 40 hex characters.");
      return;
    }
    setInputError(null);
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState({ kind: "reading" });
    // The Shield API first (registry, bytecode, owner, a simulated buy and sell); the browser checks when it is not served.
    try {
      const api = await apiGet<ApiShieldReport>(`/v1/discovery/shield/${address}`, { query: { network: on }, signal: next.signal, timeoutMs: 20_000 });
      const trust = assessToken({ network: on, address, symbol: api.token.symbol ?? undefined, name: api.token.name ?? undefined });
      setState({ kind: "done", report: shieldFromApi(api, trust), address: address.toLowerCase(), network: on, at: Date.now(), source: "api" });
      return;
    } catch {
      if (next.signal.aborted) return;
    }
    try {
      const facts = factsFrom(await readAnswers(on, address, next.signal));
      const trust = assessToken({ network: on, address, symbol: facts.symbol ?? undefined, name: facts.name ?? undefined });
      setState({ kind: "done", report: shieldReport(facts, trust), address: address.toLowerCase(), network: on, at: Date.now(), source: "browser" });
    } catch {
      if (next.signal.aborted) return;
      setState({ kind: "error", message: `${NETWORKS[on].name}'s public RPC did not answer. Try again in a moment; nothing was guessed.` });
    }
  }

  const doneNetwork = state.kind === "done" ? NETWORKS[state.network] : null;
  const explorer = doneNetwork && doneNetwork.vm === "evm" ? doneNetwork.explorer : null;

  // Phones read the verdict before the checks: form, then the sign, then the
  // list. From md up the form and its checks share one card beside the sign.
  const checksBlock = (
    <div className={cx("flex flex-1 flex-col", !narrow && "border-t-2 border-rule")} aria-live="polite">
      {state.kind === "done" ? (
        <>
          <ol className="relative">
            {state.report.checks.map((check, index) => {
              const mark = MARK[check.result];
              return (
                <li key={check.id} className="el-rise grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-b-2 border-dashed border-rule px-5 py-2 sm:grid-cols-[1.25rem_9.5rem_minmax(0,1fr)]" style={{ animationDelay: `${index * 60}ms` }}>
                  <span className={cx("font-mono text-[12px]", mark.tone)} aria-hidden="true">
                    {mark.glyph}
                  </span>
                  <span className="text-[13px] font-semibold text-ink">
                    {check.label}
                    <span className="sr-only">: {mark.word}</span>
                  </span>
                  <span className="min-w-0 break-words font-mono text-[11.5px] text-ink-2">{check.detail}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-auto flex flex-wrap items-center justify-between gap-2 px-5 py-3 font-mono text-[11px] text-ink-3">
            <span>
              {state.address.slice(0, 10)}…{state.address.slice(-6)} · {state.source === "api" ? "Elyia Shield API" : "public RPC (Shield API offline)"} · read {new Date(state.at).toLocaleTimeString("en-GB")}
            </span>
            {explorer ? (
              <a href={`${explorer.url}${explorer.addressPath}${state.address}`} target="_blank" rel="noopener noreferrer" className={cx("text-ink underline decoration-2 underline-offset-4", FOCUS_RING)}>
                explorer ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </p>
        </>
      ) : state.kind === "error" ? (
        <p className="px-5 py-6 text-center text-[14px] text-down" role="alert">
          {state.message}
        </p>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-6 text-center">
          <div className="flex flex-wrap justify-center gap-4">
            <ConditionSign condition="open" size="sm" />
            <ConditionSign condition="caution" size="sm" />
            <ConditionSign condition="closed" size="sm" />
          </div>
          <p className="max-w-[34rem] text-[14px] leading-relaxed text-ink-2 text-pretty">OPEN means checked and verified. CAUTION means something on the trail needs your eyes. CLOSED means do not climb: no contract, a look-alike, or not a token at all. Nothing here signs or spends.</p>
        </div>
      )}
    </div>
  );
  const verdictCard = (
  <section aria-label="Shield verdict" className="flex min-w-0 flex-col items-center justify-center gap-6 bg-card px-5 py-8 px-frame px-drop">
    <p className="caption">Route condition · Ely inspects</p>
    <ShieldSign condition={state.kind === "done" ? state.report.condition : null} reading={state.kind === "reading"} score={state.kind === "done" ? state.report.score : undefined} reason={state.kind === "done" ? state.report.reason : undefined} />
    {state.kind === "done" ? (
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-display text-[22px] font-bold leading-none text-ink">{state.report.facts.symbol ?? "Unknown contract"}</p>
        <p className="font-mono text-[11px] text-ink-2">
          {state.report.facts.name ?? "no name()"} · {NETWORKS[state.network].name}
        </p>
      </div>
    ) : null}
    <p className="max-w-[460px] text-center font-mono text-[11px] leading-snug text-ink-3">{flagged.length} known look-alike or suspicious token{flagged.length === 1 ? "" : "s"} on {NETWORKS[network].name}: always CLOSED, never routed or priced</p>
    <dl className="grid w-full max-w-[480px] grid-cols-2 gap-4 sm:grid-cols-4">
      {(["pass", "warn", "fail", "unknown"] as const).map((result) => (
        <div key={result} className="flex flex-col items-center gap-1 bg-paper-2 px-2 py-3 px-frame-thin">
          <dt className="font-tag text-[10px] uppercase text-ink-2">{MARK[result].word}</dt>
          <dd className={cx("tnum font-display text-[22px] font-bold leading-none", MARK[result].tone)}>
            <span aria-hidden="true">{MARK[result].glyph} </span>
            {state.kind === "done" ? state.report.checks.filter((check) => check.result === result).length : "—"}
          </dd>
        </div>
      ))}
    </dl>
  </section>
  );
  const formCard = (
  <section aria-labelledby="shield-title" className="flex min-w-0 flex-col bg-card px-frame px-drop">
    <header className="flex flex-col items-center gap-2 border-b-2 border-rule px-5 py-5 text-center">
      <p className="caption">Shield API · public RPC fallback · look-alike list always</p>
      <h3 id="shield-title" className="font-display text-[24px] font-bold leading-none text-ink">
        Check a token
      </h3>
    </header>
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void run(value, network);
      }}
    >
      {networks.length > 1 ? (
        <div className="flex justify-center">
          <SegmentedControl
            size="sm"
            label="Network"
            value={network}
            onChange={(next) => {
              setNetwork(next);
              setState({ kind: "idle" });
            }}
            options={networks.map((key) => ({ value: key, label: LAYER_WORD[key] ?? NETWORKS[key].name }))}
          />
        </div>
      ) : null}
      <div className="flex min-h-12 w-full min-w-0 items-stretch bg-paper px-frame-thin">
        <label htmlFor={id} className="flex shrink-0 items-center bg-ink px-3 font-tag text-[12px] uppercase text-paper">
          Token
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (inputError) setInputError(null);
          }}
          placeholder="0x… contract address"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={inputError ? true : undefined}
          aria-describedby={inputError ? `${id}-error` : undefined}
          className={cx("min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-3", FOCUS_RING)}
        />
      </div>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={state.kind === "reading"}>
        Check the trail →
      </Button>
      {inputError ? (
        <p id={`${id}-error`} role="alert" className="text-center text-[13px] text-down">
          {inputError}
        </p>
      ) : (
        <p className="flex flex-wrap items-center justify-center gap-3 font-mono text-[11px] text-ink-2">
          <span>try</span>
          {examples.map((token) => (
            <button
              key={token.id}
              type="button"
              onClick={() => {
                setValue(token.address!);
                void run(token.address!, network);
              }}
              className={cx("px-btn px-btn-thin px-btn-paper px-2 py-0.5 font-tag text-[11px] uppercase text-ink", FOCUS_RING)}
            >
              {token.symbol}
            </button>
          ))}
          {lookalike ? (
            <button
              type="button"
              onClick={() => {
                setValue(lookalike.address);
                void run(lookalike.address, network);
              }}
              className={cx("px-btn px-btn-thin px-btn-down px-2 py-0.5 font-tag text-[11px] uppercase text-paper", FOCUS_RING)}
              title={`A known look-alike of ${lookalike.imitates}`}
            >
              fake {lookalike.symbol ?? lookalike.imitates}
            </button>
          ) : null}
          <span>or paste any contract</span>
        </p>
      )}
    </form>
      {narrow ? null : checksBlock}
    </section>
  );
  if (narrow) {
    return (
      <div className="flex flex-col gap-7">
        {formCard}
        {verdictCard}
        <section aria-label="Shield checks" className="flex min-w-0 flex-col bg-card px-frame px-drop">
          {checksBlock}
        </section>
      </div>
    );
  }
  return (
    <Split>
      {formCard}
      {verdictCard}
    </Split>
  );
}
