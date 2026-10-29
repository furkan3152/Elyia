import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE } from "../../lib/env";
import { Reveal } from "../../motion/Reveal";
import { cssVars } from "../../motion/tokens";
import { ConditionSign } from "../../topo/ConditionSign";
import type { Condition } from "../../topo/geometry/conditions";
import { Button } from "../../ui/Button";
import { copyText } from "../../ui/clipboard";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Tag } from "../../ui/Badge";
import { toast } from "../../ui/toast";
import { ERROR_EXAMPLE, MANUAL, probes, snippets, SURVEY_WORDS, surveyCounts, type Altitude, type AltitudeGroup, type Snippet, type Survey } from "./manual";

const CONDITION: Readonly<Record<Survey, Condition>> = { open: "open", partial: "caution", surveying: "closed" };
const PROFILE_ORDER: readonly Altitude[] = ["base", "floor", "range", "summit", "guide"];
const ALT_TEXT: Readonly<Record<Altitude, string>> = { base: "text-ink", floor: "text-floor", ridge: "text-ridge", range: "text-ridge", summit: "text-summit-ink", guide: "text-ink-2" };

/* Live probes -------------------------------------------------------------- */

type Probe = { readonly state: "pending" } | { readonly state: "answered"; readonly status: number; readonly ms: number; readonly body: string; readonly requestId: string | null } | { readonly state: "silent"; readonly reason: string };

async function probeOnce(path: string, signal: AbortSignal): Promise<Probe> {
  const started = performance.now();
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 5_000);
  const onAbort = () => timeout.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(new URL(path, API_BASE).toString(), { headers: { Accept: "application/json" }, credentials: "omit", signal: timeout.signal });
    const text = await response.text();
    let body = text;
    try {
      body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // not JSON: show as is
    }
    return { state: "answered", status: response.status, ms: Math.round(performance.now() - started), body, requestId: response.headers.get("x-request-id") };
  } catch {
    return { state: "silent", reason: signal.aborted ? "cancelled" : timeout.signal.aborted ? "no answer within 5 s" : "could not reach the API" };
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** One quiet read of every safe GET, in sequence, so the manual can say which routes answer right now. */
function useProbes(): ReadonlyMap<string, Probe> {
  const [results, setResults] = useState<ReadonlyMap<string, Probe>>(() => new Map(probes().map((path) => [path, { state: "pending" } as Probe])));
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      for (const path of probes()) {
        if (controller.signal.aborted) return;
        const result = await probeOnce(path, controller.signal);
        if (controller.signal.aborted) return;
        setResults((previous) => new Map(previous).set(path, result));
        // The first silence means the API is down: mark the rest without waiting 5 s each.
        if (result.state === "silent") {
          setResults((previous) => {
            const next = new Map(previous);
            for (const [key, value] of next) if (value.state === "pending") next.set(key, result);
            return next;
          });
          return;
        }
      }
    })();
    return () => controller.abort();
  }, []);
  return results;
}

function probeWords(probe: Probe | undefined): string {
  if (!probe) return "";
  if (probe.state === "pending") return "asking…";
  if (probe.state === "silent") return probe.reason;
  return `answered ${probe.status} · ${probe.ms} ms`;
}

/* The field console ------------------------------------------------------- */

function FieldConsole({ results }: { readonly results: ReadonlyMap<string, Probe> }) {
  const paths = useMemo(() => probes(), []);
  const [path, setPath] = useState(paths[0] ?? "/v1/health");
  const [running, setRunning] = useState<Probe | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setRunning({ state: "pending" });
    setRunning(await probeOnce(path, next.signal));
  }, [path]);
  const shown = running ?? results.get(path);
  const lines = shown && shown.state === "answered" ? shown.body.split("\n") : [];
  const clipped = lines.length > 26 ? [...lines.slice(0, 26), `  … ${lines.length - 26} more lines`] : lines;
  const ok = shown?.state === "answered" && shown.status < 400;
  return (
    <section aria-labelledby="console-title" className="flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard-xl">
      <header className="flex items-center justify-between gap-3 border-b-2 border-rule px-4 py-2.5">
        <h2 id="console-title" className="caption !text-ink">
          Field console · ask the API, read the answer
        </h2>
        <span className="caption truncate">{new URL(API_BASE).host}</span>
      </header>
      <div className="flex flex-col gap-3 border-b-1.5 border-dashed border-rule/60 p-4 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-stretch border-2 border-rule bg-paper">
          <span className="flex items-center bg-ink px-2.5 font-mono text-[12px] font-semibold tracking-[0.08em] text-paper">GET</span>
          <span className="sr-only">Endpoint</span>
          <select value={path} onChange={(event) => { setPath(event.target.value); setRunning(null); }} className={cx("min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[13px] text-ink", FOCUS_RING)}>
            {paths.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" onClick={() => void run()} loading={running?.state === "pending"}>
          Send →
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-2 font-mono text-[12px]">
        <span className={cx("font-semibold", shown?.state === "answered" ? (ok ? "text-up" : "text-down") : "text-ink-2")}>
          {shown?.state === "answered" ? `${ok ? "▲" : "▼"} ${shown.status} · ${shown.ms} ms` : shown?.state === "silent" ? `▼ ${shown.reason}` : "asking…"}
        </span>
        {shown?.state === "answered" && shown.requestId ? <span className="truncate text-ink-3">x-request-id {shown.requestId.slice(0, 8)}…</span> : null}
      </div>
      <pre className="tnum m-0 h-[260px] overflow-auto whitespace-pre-wrap break-words sm:h-[320px] border-t-1.5 border-rule bg-paper-2 px-4 py-3 font-mono text-[12px] leading-[1.55] text-ink" tabIndex={0} aria-label="Response">
        {shown?.state === "answered" ? clipped.join("\n") : shown?.state === "silent" ? `No answer from ${API_BASE}.\n\nThe Elyia API is not running here, or it is still warming up.\nRun it locally:\n\n  npm run dev -w @elyia/api\n\nNothing on this page is invented: when the API is silent,\nthe console says so.` : "…"}
      </pre>
    </section>
  );
}

/* The trail profile index ------------------------------------------------- */

function TrailProfile({ groups }: { readonly groups: readonly AltitudeGroup[] }) {
  const ordered = PROFILE_ORDER.map((altitude) => groups.find((group) => group.altitude === altitude)).filter((group): group is AltitudeGroup => group !== undefined);
  const heights = [0.82, 0.62, 0.42, 0.14, 0.5];
  const W = 1000;
  const H = 150;
  const xs = ordered.map((_, index) => 70 + (index * (W - 140)) / Math.max(1, ordered.length - 1));
  const ys = ordered.map((_, index) => 18 + heights[index]! * (H - 50));
  let d = `M0,${H - 8} L${xs[0]! - 40},${ys[0]! + 22}`;
  ordered.forEach((_, index) => {
    if (index === 0) d += ` L${xs[0]},${ys[0]}`;
    else {
      const mx = (xs[index - 1]! + xs[index]!) / 2;
      d += ` C${mx},${ys[index - 1]} ${mx},${ys[index]} ${xs[index]},${ys[index]}`;
    }
  });
  d += ` L${W},${H - 30}`;
  return (
    <nav aria-label="The manual, by altitude" className="relative hidden border-2 border-rule bg-card shadow-hard sm:block">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="dev-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0,0 V7" className="stroke-contour" strokeWidth="1.2" opacity="0.55" />
          </pattern>
        </defs>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill="url(#dev-hatch)" />
        <path d={d} fill="none" className="stroke-rule el-draw" strokeWidth="2.2" strokeLinejoin="round" pathLength={1} style={cssVars({ "--el-draw-dur": "1600ms" })} />
        {ordered.map((group, index) => (
          <g key={group.altitude} transform={`translate(${xs[index]} ${ys[index]})`}>
            <path d="M-9,7 L0,-8 L9,7 Z" className={group.altitude === "summit" ? "fill-signal stroke-rule" : "fill-card stroke-rule"} strokeWidth="2" />
          </g>
        ))}
      </svg>
      <ol className="absolute inset-0 grid grid-cols-5">
        {ordered.map((group, index) => {
          const counts = surveyCounts([group]);
          const below = ys[index]! / H < 0.45;
          return (
            <li key={group.altitude} className="relative">
              <a href={`#alt-${group.altitude}`} className={cx("absolute inset-x-1 flex flex-col items-center text-center", below ? "bottom-2" : "top-2", FOCUS_RING)}>
                <span className={cx("map-label text-[15px] leading-none sm:text-[22px]", ALT_TEXT[group.altitude])}>{group.title}</span>
                <span className="tnum mt-1 hidden font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 sm:block">
                  {counts.open + counts.partial}/{group.endpoints.length} served
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* The log book ------------------------------------------------------------- */

function ManualGroup({ group, results }: { readonly group: AltitudeGroup; readonly results: ReadonlyMap<string, Probe> }) {
  return (
    <section id={`alt-${group.altitude}`} aria-labelledby={`alt-${group.altitude}-title`} className="scroll-mt-24 border-2 border-rule bg-card shadow-hard">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-rule px-5 pb-2 pt-4">
        <h3 id={`alt-${group.altitude}-title`} className={cx("map-label text-[28px] leading-tight", ALT_TEXT[group.altitude])}>
          {group.title}
        </h3>
        <span className="caption">{group.subtitle}</span>
      </header>
      <ul>
        {group.endpoints.map((endpoint) => {
          const probe = endpoint.probe ? results.get(endpoint.probe) : undefined;
          return (
            <li key={`${endpoint.method} ${endpoint.path}`} className="grid grid-cols-1 gap-x-5 gap-y-2 border-b border-rule/15 px-5 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_12.5rem] md:items-center">
              <code className="flex min-w-0 items-center gap-2.5 font-mono text-[13px] text-ink">
                <span className={cx("w-[3.25rem] shrink-0 border-1.5 border-rule py-px text-center text-[10px] font-semibold tracking-[0.08em]", endpoint.method === "GET" ? "bg-card" : endpoint.method === "SSE" ? "bg-summit text-card" : "bg-ink text-paper")}>{endpoint.method}</span>
                <span className="break-all">{endpoint.path}</span>
              </code>
              <p className="text-[14px] leading-snug text-ink-2">
                {endpoint.what}
                {endpoint.note ? <span className="mt-0.5 block font-mono text-[11px] text-warn-ink">{endpoint.note}</span> : null}
              </p>
              <div className="flex flex-col items-start gap-1">
                <ConditionSign condition={CONDITION[endpoint.survey]} size="sm" reason={SURVEY_WORDS[endpoint.survey]} />
                {probe && probe.state !== "silent" ? <span className={cx("tnum font-mono text-[11px]", probe.state === "answered" && probe.status < 400 ? "text-up" : probe.state === "pending" ? "text-ink-3" : "text-ink-2")}>{probeWords(probe)}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* Paper cards ------------------------------------------------------------- */

function PaperCard({ snippet, index }: { readonly snippet: Snippet; readonly index: number }) {
  const languages = (["curl", "ts", "json"] as const).filter((language) => snippet.code[language] !== undefined);
  const [language, setLanguage] = useState(languages[0]!);
  const code = snippet.code[language] ?? "";
  const copy = async () => {
    const ok = await copyText(code);
    if (ok) toast.success("Copied", { description: `${snippet.title} · ${language === "ts" ? "TypeScript" : language}` });
    else toast.error("The browser refused to copy", { description: "Select the text and copy it by hand." });
  };
  return (
    <article className={cx("el-laminate relative flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard-lg", snippet.survey === "surveying" && "border-dashed")} style={cssVars({ "--el-delay": `${index * 70}ms` })}>
      <header className="flex items-start justify-between gap-3 border-b-1.5 border-dashed border-rule/60 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p className="caption">
            Card {String(index + 1).padStart(2, "0")} · {snippet.caption}
          </p>
          <h3 className="mt-1.5 text-[22px] font-bold leading-tight tracking-[-0.01em] text-ink">{snippet.title}</h3>
        </div>
        <ConditionSign condition={CONDITION[snippet.survey]} size="sm" />
      </header>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        {languages.length > 1 ? (
          <SegmentedControl
            size="sm"
            label={`${snippet.title}: language`}
            value={language}
            onChange={setLanguage}
            options={languages.map((value) => ({ value, label: value === "ts" ? "TypeScript" : value }))}
          />
        ) : (
          <span className="caption">{language === "json" ? "mcp client config" : language}</span>
        )}
        <Button variant="ink" size="xs" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <pre className="m-0 min-h-[180px] flex-1 overflow-x-auto border-t-1.5 border-rule bg-paper-2 px-4 py-3 font-mono text-[12px] leading-[1.6] text-ink" tabIndex={0} aria-label={`${snippet.title}, ${language} snippet`}>
        {code}
      </pre>
      {snippet.survey === "surveying" ? <p className="border-t-1.5 border-dashed border-rule/60 px-4 py-2 font-mono text-[11px] text-ink-2">Specified, not served yet: this card shows the shape it will take. Tools: markets, funding, portfolio, pulse, plan_route; a plan_route answer is a signing link, never a signature.</p> : null}
    </article>
  );
}

const RULES = [
  ["The server never signs", "Wallets sign EVM transactions and user-signed HyperCore actions; the in-browser trade-only key signs L1 orders. You submit references, never keys."],
  ["Every quote is bound", "prepare returns unsigned requests and a quote binding: a hash of the fields that matter. If the world moved, submit refuses and says why."],
  ["Proof comes from the chain", "Outcomes are read back from receipts, logs and the HyperCore info API. A reference is claimed once, globally."],
  ["Fail closed, in plain words", "Unknown price, unknown token, stale quote: the answer is a refusal with the fix, in the error envelope beside these rules."],
] as const;

/** "/developers": the survey office's field manual. API, streams, route cards and MCP, with a console that asks the real API. */
export default function DevelopersPage() {
  const results = useProbes();
  const cards = useMemo(() => snippets(API_BASE), []);
  const counts = surveyCounts();
  const ordered = PROFILE_ORDER.map((altitude) => MANUAL.find((group) => group.altitude === altitude)).filter((group): group is AltitudeGroup => group !== undefined);
  const health = results.get("/v1/health");

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-16 px-4 pb-14 pt-10 sm:px-6 lg:gap-20 lg:px-10 lg:pt-14">
      <header className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <div className="flex min-w-0 flex-col gap-6">
          <Tag className="self-start">Sheet 11 · the field manual · builders</Tag>
          <h1 className="text-[48px] font-bold leading-[0.98] tracking-[-0.03em] text-balance sm:text-[72px]">Build on the range.</h1>
          <p className="max-w-[36rem] text-[18px] leading-relaxed text-ink-2">
            The API that runs Elyia, open to you: one portfolio across HyperCore, HyperEVM and Elysium, live markets, Elysium&apos;s blocks as a stream, and route cards that are quoted, checked and proven, while your users sign every step.
          </p>
          <dl className="tnum grid max-w-[34rem] grid-cols-3 border-2 border-rule bg-card font-mono shadow-hard">
            {(
              [
                ["served", counts.open, "text-up"],
                ["with gaps", counts.partial, "text-warn-ink"],
                ["being surveyed", counts.surveying, "text-ink-2"],
              ] as const
            ).map(([label, value, tone], index) => (
              <div key={label} className={cx("px-4 py-3", index < 2 && "border-r-1.5 border-rule")}>
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
                <dd className={cx("mt-1 text-[28px] font-semibold leading-none", tone)}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="font-mono text-[12px] text-ink-2">
            {health?.state === "answered" ? (
              <>
                <span className="text-up">▲</span> this API answered in {health.ms} ms · base {API_BASE}
              </>
            ) : health?.state === "silent" ? (
              <>
                <span className="text-down">▼</span> no API at {API_BASE} right now · the manual still reads true
              </>
            ) : (
              <>asking {API_BASE}…</>
            )}
          </p>
        </div>
        <FieldConsole results={results} />
      </header>

      <section aria-labelledby="manual-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 id="manual-title" className="text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[40px]">
            The API, by altitude
          </h2>
          <p className="max-w-[44rem] text-[17px] leading-relaxed text-ink-2">
            Every route, filed where it lives. The sign says whether this build serves it; the line under it is what the API told your browser a moment ago.
          </p>
        </div>
        <TrailProfile groups={MANUAL} />
        <div className="flex flex-col gap-6">
          {ordered.map((group) => (
            <ManualGroup key={group.altitude} group={group} results={results} />
          ))}
        </div>
      </section>

      <Reveal as="section" aria-labelledby="cards-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h2 id="cards-title" className="text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[40px]">
            Paper cards
          </h2>
          <p className="max-w-[44rem] text-[17px] leading-relaxed text-ink-2">
            Copy, paste, climb. Types come from <code className="bg-paper-2 px-1 font-mono text-[0.88em] text-ink">@elyia/core/api/*</code>, the same contracts the app is built on; a packaged SDK follows once the routes above are all served.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {cards.map((snippet, index) => (
            <PaperCard key={snippet.id} snippet={snippet} index={index} />
          ))}
        </div>
      </Reveal>

      <Reveal as="section" aria-labelledby="rules-title" className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <h2 id="rules-title" className="text-[34px] font-bold leading-tight tracking-[-0.02em] sm:text-[40px]">
            Rules of the range
          </h2>
          <ol className="flex flex-col gap-4">
            {RULES.map(([title, body], index) => (
              <li key={title} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3">
                <span className={cx("flex h-9 w-9 items-center justify-center border-2 border-rule font-mono text-sm font-semibold shadow-hard", index === 0 ? "bg-signal text-signal-ink" : "bg-card text-ink")}>{index + 1}</span>
                <span>
                  <span className="block text-[17px] font-bold text-ink">{title}</span>
                  <span className="block text-[15px] leading-snug text-ink-2">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <figure className="flex min-w-0 flex-col border-2 border-rule bg-card shadow-hard-lg">
          <figcaption className="flex items-center justify-between gap-3 border-b-1.5 border-rule px-4 py-2.5">
            <span className="caption !text-ink">The error envelope · every refusal looks like this</span>
            <span className="caption">4xx · 5xx</span>
          </figcaption>
          <pre className="m-0 whitespace-pre-wrap break-words bg-paper-2 px-4 py-3 font-mono text-[12px] leading-[1.6] text-ink" tabIndex={0} aria-label="Error envelope example">
            {ERROR_EXAMPLE}
          </pre>
          <p className="border-t-1.5 border-dashed border-rule/60 px-4 py-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
            Rate limits per IP; heavy routes cost more. HyperCore allows 1,200 weight a minute per IP, so per-user live streams belong in the user&apos;s own browser.
          </p>
        </figure>
      </Reveal>
    </div>
  );
}
