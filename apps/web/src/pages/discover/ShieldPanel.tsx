import { assessToken, tokensFor } from "@elyia/core/assets";
import { NETWORKS, type NetworkEnvironment, type NetworkKey } from "@elyia/core/networks";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ConditionSign } from "../../topo/ConditionSign";
import { Button } from "../../ui/Button";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { factsFrom, shieldCalls, shieldReport, type CheckResult, type RawAnswer, type ShieldReport } from "./shield";

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

type State = { readonly kind: "idle" } | { readonly kind: "reading" } | { readonly kind: "done"; readonly report: ShieldReport; readonly address: string; readonly network: NetworkKey; readonly at: number } | { readonly kind: "error"; readonly message: string };

/**
 * Shield: paste a token, get its route condition. Runs in the browser
 * against the public RPC and Elyia's verified list; says which
 * checks need the discovery API and were not run.
 */
export function ShieldPanel({ mode }: { readonly mode: NetworkEnvironment }) {
  const id = useId();
  const networks = NETWORKS_BY_MODE[mode];
  const [network, setNetwork] = useState<NetworkKey>(networks[0]!);
  const [value, setValue] = useState(() => tokensFor(networks[0]!).find((token) => token.address !== null)?.address ?? "");
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const examples = useMemo(() => tokensFor(network).filter((token) => token.address !== null).slice(0, 3), [network]);

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
    try {
      const facts = factsFrom(await readAnswers(on, address, next.signal));
      const trust = assessToken({ network: on, address, symbol: facts.symbol ?? undefined, name: facts.name ?? undefined });
      setState({ kind: "done", report: shieldReport(facts, trust), address: address.toLowerCase(), network: on, at: Date.now() });
    } catch {
      if (next.signal.aborted) return;
      setState({ kind: "error", message: `${NETWORKS[on].name}'s public RPC did not answer. Try again in a moment; nothing was guessed.` });
    }
  }

  const doneNetwork = state.kind === "done" ? NETWORKS[state.network] : null;
  const explorer = doneNetwork && doneNetwork.vm === "evm" ? doneNetwork.explorer : null;

  return (
    <section aria-labelledby="shield-title" className="flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard-xl">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-2 border-rule px-4 py-2.5">
        <h2 id="shield-title" className="caption !text-ink">
          Shield · route condition for any token
        </h2>
        <span className="caption">read from the public RPC</span>
      </header>
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(value, network);
        }}
      >
        {networks.length > 1 ? (
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
        ) : null}
        <div className="flex h-12 w-full min-w-0 items-stretch border-2 border-rule bg-paper shadow-hard focus-within:shadow-hard-lg">
          <label htmlFor={id} className="flex shrink-0 items-center bg-ink px-3 font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-paper">
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
            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <Button type="submit" variant="primary" className="!h-auto !border-y-0 !border-r-0 !shadow-none" loading={state.kind === "reading"}>
            Check →
          </Button>
        </div>
        {inputError ? (
          <p id={`${id}-error`} role="alert" className="text-[13px] text-down">
            {inputError}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-2">
            <span>try</span>
            {examples.map((token) => (
              <button
                key={token.id}
                type="button"
                onClick={() => {
                  setValue(token.address!);
                  void run(token.address!, network);
                }}
                className={cx("border-1.5 border-rule/40 px-1.5 py-0.5 text-ink hover:border-rule hover:bg-paper-2", FOCUS_RING)}
              >
                {token.symbol}
              </button>
            ))}
            <span>or paste any contract</span>
          </p>
        )}
      </form>

      <div className="border-t-1.5 border-rule" aria-live="polite">
        {state.kind === "idle" ? (
          <div className="flex flex-col gap-3 px-4 py-5">
            <div className="flex flex-wrap gap-2">
              <ConditionSign condition="open" size="sm" />
              <ConditionSign condition="caution" size="sm" />
              <ConditionSign condition="closed" size="sm" />
            </div>
            <p className="max-w-[34rem] text-[14px] leading-relaxed text-ink-2">
              OPEN means checked and verified. CAUTION means something on the trail needs your eyes. CLOSED means do not climb: no contract, a look-alike, or not a token at all. Nothing here signs or spends.
            </p>
          </div>
        ) : state.kind === "reading" ? (
          <p className="px-4 py-5 font-mono text-[13px] text-ink-2">Reading the contract on {NETWORKS[network].name}…</p>
        ) : state.kind === "error" ? (
          <p className="px-4 py-5 text-[14px] text-down" role="alert">
            {state.message}
          </p>
        ) : (
          <div className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-1.5 border-dashed border-rule/60 px-4 py-4">
              <div className="min-w-0">
                <p className="truncate text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">{state.report.facts.symbol ?? "Unknown contract"}</p>
                <p className="truncate font-mono text-[11px] text-ink-2">
                  {state.report.facts.name ?? "no name()"} · {NETWORKS[state.network].name}
                </p>
              </div>
              <ConditionSign condition={state.report.condition} score={state.report.score} reason={state.report.reason} />
            </div>
            <ol className="el-logbook relative">
              {state.report.checks.map((check, index) => {
                const mark = MARK[check.result];
                return (
                  <li key={check.id} className="el-rise grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)] sm:grid-cols-[1.25rem_9.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-rule/10 px-4 py-2 last:border-b-0" style={{ animationDelay: `${index * 60}ms` }}>
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
            <p className="flex flex-wrap items-center justify-between gap-2 border-t-1.5 border-dashed border-rule/60 px-4 py-2.5 font-mono text-[11px] text-ink-3">
              <span>
                {state.address.slice(0, 10)}…{state.address.slice(-6)} · read {new Date(state.at).toLocaleTimeString("en-GB")}
              </span>
              {explorer ? (
                <a href={`${explorer.url}${explorer.addressPath}${state.address}`} target="_blank" rel="noopener noreferrer" className={cx("text-ink underline decoration-accent-line decoration-2 underline-offset-4", FOCUS_RING)}>
                  explorer ↗<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
