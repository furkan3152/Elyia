import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useResolvedTheme } from "../../app/state/useTheme";
import { API_BASE } from "../../lib/env";
import { prefersReducedMotion } from "../../motion/useReducedMotion";
import { Ely } from "../../pixel/Ely";
import { Cards, Page, Section } from "../../pixel/layout";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import type { ElyState } from "../../pixel/states";
import { ConditionSign } from "../../topo/ConditionSign";
import type { Condition } from "../../topo/geometry/conditions";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { copyText } from "../../ui/clipboard";
import { cx, FOCUS_RING } from "../../ui/cx";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { toast } from "../../ui/toast";
import { Readout } from "../landing/PulseReadouts";
import { ERROR_EXAMPLE, MANUAL, probes, snippets, SURVEY_WORDS, surveyCounts, type Altitude, type AltitudeGroup, type Snippet, type Survey } from "./manual";
import { CAMP_HEIGHTS, paintProfile, PROFILE_H } from "./trailProfile";

const CONDITION: Readonly<Record<Survey, Condition>> = { open: "open", partial: "caution", surveying: "closed" };
const PROFILE_ORDER: readonly Altitude[] = ["base", "floor", "range", "summit", "guide"];
const ALT_TEXT: Readonly<Record<Altitude, string>> = { base: "text-ink", floor: "text-floor", ridge: "text-ridge", range: "text-ridge", summit: "text-summit-ink", guide: "text-ink-2" };
/** The console is a lit screen on both sheets: fixed ink and phosphor colours. */
const SCREEN = "bg-[#16201B] text-[#CFEFF3]";

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

/** Ely reads the answer: climbing while asking, summit on 2xx/3xx, holding on for an error, asleep when nobody answers. */
function elyFor(probe: Probe | undefined): { readonly state: ElyState; readonly words: string } {
  if (!probe || probe.state === "pending") return { state: "climb", words: "Asking the API…" };
  if (probe.state === "silent") return { state: "sleep", words: "Nobody answers. The API is not running here." };
  if (probe.status < 400) return { state: "summit", words: "Answered. Proof on the screen." };
  return { state: "worry", words: "Refused. The error envelope says why." };
}

/* The pixel console ------------------------------------------------------- */

/** Prints new answers top to bottom in twelve steps (reduced motion: at once). */
function usePrintOn(element: HTMLElement | null, key: unknown): void {
  useLayoutEffect(() => {
    if (!element || prefersReducedMotion() || typeof element.animate !== "function") return;
    element.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 480, easing: "steps(12, end)" });
  }, [element, key]);
}

function FieldConsole({ results }: { readonly results: ReadonlyMap<string, Probe> }) {
  const paths = useMemo(() => probes(), []);
  const [path, setPath] = useState(paths[0] ?? "/v1/health");
  const [running, setRunning] = useState<Probe | null>(null);
  const [screen, setScreen] = useState<HTMLPreElement | null>(null);
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
  const clipped = lines.length > 24 ? [...lines.slice(0, 24), `  … ${lines.length - 24} more lines`] : lines;
  const ok = shown?.state === "answered" && shown.status < 400;
  const ely = elyFor(shown);
  usePrintOn(screen, shown);
  return (
    <div className="mx-auto max-w-[1000px] bg-card px-frame px-drop-lg">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <label className="flex min-w-0 flex-1 items-stretch bg-paper px-frame-thin">
          <span className="flex items-center bg-ink px-3 font-tag text-[12px] text-paper">GET</span>
          <span className="sr-only">Endpoint</span>
          <select
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setRunning(null);
            }}
            className={cx("min-w-0 flex-1 cursor-pointer bg-transparent px-3 py-2.5 font-mono text-[14px] text-ink", FOCUS_RING)}
          >
            {paths.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>
        <Button variant="primary" size="lg" onClick={() => void run()} loading={running?.state === "pending"}>
          Send →
        </Button>
      </div>
      <div className={cx("relative border-t-2 border-rule", SCREEN)}>
        <div className="flex flex-col items-center gap-2 border-b-2 border-dashed border-[#CFEFF3]/25 px-4 pb-4 pt-5 text-center">
          <Ely state={ely.state} size={88} label={`Ely: ${ely.words}`} />
          <p className="font-tag text-[12px] uppercase" aria-live="polite">
            <span className={shown?.state === "answered" ? (ok ? "text-[#5FD39A]" : "text-[#FF8A7E]") : "text-[#CFEFF3]"}>
              {shown?.state === "answered" ? `${ok ? "▲" : "▼"} ${shown.status} · ${shown.ms} ms` : shown?.state === "silent" ? `▼ ${shown.reason}` : "asking…"}
            </span>
            <span className="text-[#9FB4C2]"> · {ely.words}</span>
          </p>
          <p className="font-mono text-[11px] text-[#9FB4C2]">
            {new URL(API_BASE).host}
            {path}
            {shown?.state === "answered" && shown.requestId ? ` · x-request-id ${shown.requestId.slice(0, 8)}…` : ""}
          </p>
        </div>
        <pre
          ref={setScreen}
          className="tnum m-0 h-[300px] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[12px] leading-[1.6] sm:h-[360px]"
          style={{ backgroundImage: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.035) 0 2px, transparent 2px 4px)" }}
          tabIndex={0}
          aria-label="Response"
        >
          {shown?.state === "answered"
            ? clipped.join("\n")
            : shown?.state === "silent"
              ? `No answer from ${API_BASE}.\n\nThe Elyia API is not running here, or it is still warming up.\nRun it locally:\n\n  npm run dev -w @elyia/api\n\nNothing on this page is invented: when the API is silent,\nthe console says so.`
              : "…"}
          <span aria-hidden="true" className="ml-1 inline-block h-[1em] w-[0.6em] translate-y-[2px] bg-[#6FD3E3] align-baseline" />
        </pre>
      </div>
    </div>
  );
}

/* The trail profile index ------------------------------------------------- */

function TrailProfile({ groups }: { readonly groups: readonly AltitudeGroup[] }) {
  const ordered = PROFILE_ORDER.map((altitude) => groups.find((group) => group.altitude === altitude)).filter((group): group is AltitudeGroup => group !== undefined);
  const theme = useResolvedTheme();
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) => {
    const ink = getComputedStyle(ctx.canvas).getPropertyValue("--ink").trim().split(/\s+/u).join(",");
    paintProfile(ctx, info.w, info.seconds, info.still, 3, ink ? `rgb(${ink})` : undefined);
  }, []);
  return (
    <nav aria-label="The manual, by altitude" className="bg-card px-frame px-drop">
      <div className="hidden sm:block">
        <PixelCanvas width={200} height={PROFILE_H} pixelSize={5} draw={draw} animate fps={8} decorative redrawKey={theme} />
      </div>
      <ol className="m-0 flex list-none flex-wrap justify-center gap-y-3 border-t-2 border-rule px-2 py-4 sm:gap-y-0">
        {ordered.slice(0, CAMP_HEIGHTS.length).map((group) => {
          const counts = surveyCounts([group]);
          return (
            <li key={group.altitude} className="flex w-1/2 justify-center sm:w-1/5">
              <a href={`#alt-${group.altitude}`} className={cx("flex flex-col items-center px-2 text-center", FOCUS_RING)}>
                <span className={cx("font-display text-[18px] font-bold leading-tight sm:text-[20px]", ALT_TEXT[group.altitude])}>{group.title}</span>
                <span className="tnum font-tag text-[10px] uppercase text-ink-2">
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

const METHOD: Readonly<Record<string, string>> = { GET: "bg-card text-ink", SSE: "bg-summit text-[#16201B]", POST: "bg-accent text-accent-ink", PATCH: "bg-ridge text-card", DELETE: "bg-down text-card" };

function ManualGroup({ group, results }: { readonly group: AltitudeGroup; readonly results: ReadonlyMap<string, Probe> }) {
  return (
    <section id={`alt-${group.altitude}`} aria-labelledby={`alt-${group.altitude}-title`} className="scroll-mt-28 bg-card px-frame px-drop">
      <header className="flex flex-col items-center gap-0.5 border-b-2 border-rule px-5 pb-3 pt-4 text-center">
        <h3 id={`alt-${group.altitude}-title`} className={cx("font-display text-[26px] font-bold leading-tight", ALT_TEXT[group.altitude])}>
          {group.title}
        </h3>
        <span className="font-tag text-[11px] uppercase text-ink-2">{group.subtitle}</span>
      </header>
      <ul className="m-0 list-none p-0">
        {group.endpoints.map((endpoint, index) => {
          const probe = endpoint.probe ? results.get(endpoint.probe) : undefined;
          return (
            <li key={`${endpoint.method} ${endpoint.path}`} className={cx("grid grid-cols-1 gap-x-6 gap-y-2 px-5 py-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_11rem] md:items-center", index > 0 && "border-t-2 border-dashed border-rule")}>
              <code className="flex min-w-0 items-center gap-3 font-mono text-[13px] text-ink">
                <span className={cx("w-[3.25rem] shrink-0 py-0.5 text-center font-tag text-[10px] px-frame-thin", METHOD[endpoint.method])}>{endpoint.method}</span>
                <span className="break-all">{endpoint.path}</span>
              </code>
              <p className="text-[14px] leading-snug text-ink-2">
                {endpoint.what}
                {endpoint.note ? <span className="mt-0.5 block font-mono text-[11px] text-warn-ink">{endpoint.note}</span> : null}
              </p>
              <div className="flex flex-col items-start gap-1 md:items-end">
                <ConditionSign condition={CONDITION[endpoint.survey]} size="sm" />
                {endpoint.survey === "open" ? null : <span className="font-tag text-[10px] uppercase text-ink-2">{SURVEY_WORDS[endpoint.survey]}</span>}
                {probe && probe.state !== "silent" ? <span className={cx("tnum font-mono text-[11px]", probe.state === "answered" && probe.status < 400 ? "text-up" : probe.state === "pending" ? "text-ink-3" : "text-ink-2")}>{probeWords(probe)}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* Snippet cards ------------------------------------------------------------ */

function SnippetCard({ snippet, index }: { readonly snippet: Snippet; readonly index: number }) {
  const languages = (["curl", "ts", "json"] as const).filter((language) => snippet.code[language] !== undefined);
  const [language, setLanguage] = useState(languages[0]!);
  const code = snippet.code[language] ?? "";
  const copy = async () => {
    const ok = await copyText(code);
    if (ok) toast.success("Copied", { description: `${snippet.title} · ${language === "ts" ? "TypeScript" : language}` });
    else toast.error("The browser refused to copy", { description: "Select the text and copy it by hand." });
  };
  return (
    <article className={cx("flex h-full min-w-0 flex-col bg-card px-frame px-drop", snippet.survey === "surveying" && "px-tone-accent")}>
      <header className="flex flex-col items-center gap-2 px-4 pb-4 pt-5 text-center">
        <span className="font-tag text-[11px] uppercase text-ink-2">
          Card {String(index + 1).padStart(2, "0")} · {snippet.caption}
        </span>
        <h3 className="font-display text-[24px] font-bold leading-tight text-ink">{snippet.title}</h3>
        <ConditionSign condition={CONDITION[snippet.survey]} size="sm" />
      </header>
      <div className="flex items-center justify-between gap-3 border-t-2 border-rule px-4 py-3">
        {languages.length > 1 ? (
          <SegmentedControl size="sm" label={`${snippet.title}: language`} value={language} onChange={setLanguage} options={languages.map((value) => ({ value, label: value === "ts" ? "TypeScript" : value }))} />
        ) : (
          <span className="font-tag text-[11px] uppercase text-ink-2">{language === "json" ? "mcp client config" : language}</span>
        )}
        <Button variant="ink" size="xs" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <pre className={cx("m-0 min-h-[200px] flex-1 overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.6]", SCREEN)} tabIndex={0} aria-label={`${snippet.title}, ${language} snippet`}>
        {code}
      </pre>
      {snippet.survey === "surveying" ? <p className="px-4 py-3 text-center font-mono text-[11px] leading-relaxed text-ink-2">Specified, not served yet: this card shows the shape it will take. A plan_route answer is a signing link, never a signature.</p> : null}
    </article>
  );
}

const RULES = [
  ["The server never signs", "Wallets sign EVM transactions and user-signed HyperCore actions; the in-browser trade-only key signs L1 orders. You submit references, never keys."],
  ["Every quote is bound", "prepare returns unsigned requests and a quote binding: a hash of the fields that matter. If the world moved, submit refuses and says why."],
  ["Proof comes from the chain", "Outcomes are read back from receipts, logs and the HyperCore info API. A reference is claimed once, globally."],
  ["Fail closed, in plain words", "Unknown price, unknown token, stale quote: the answer is a refusal with the fix, in the error envelope below."],
] as const;

/** "/developers": the survey office's field manual. A pixel console that asks the real API, the routes by altitude, snippet cards and the rules. */
export default function DevelopersPage() {
  const results = useProbes();
  const cards = useMemo(() => snippets(API_BASE), []);
  const counts = surveyCounts();
  const ordered = PROFILE_ORDER.map((altitude) => MANUAL.find((group) => group.altitude === altitude)).filter((group): group is AltitudeGroup => group !== undefined);
  const health = results.get("/v1/health");

  return (
    <Page className="!pt-0">
      <Section
        id="manual-top"
        level={1}
        tag="Sheet 11 · the field manual · builders"
        title="Build on the range."
        lede="The API that runs Elyia, open to you: one portfolio across HyperCore, HyperEVM and Elysium, live markets, Elysium's blocks as a stream, and route cards that are quoted, checked and proven, while your users sign every step."
        actions={
          health?.state === "answered" ? (
            <Badge tone="up" dot="pulse" size="md">
              ▲ API answered in {health.ms} ms
            </Badge>
          ) : health?.state === "silent" ? (
            <Badge tone="down" size="md">
              ▼ No API at {new URL(API_BASE).host} · the manual still reads true
            </Badge>
          ) : (
            <Badge size="md">Asking {new URL(API_BASE).host}…</Badge>
          )
        }
      >
        <Cards n={3} className="mx-auto max-w-[1000px]">
          <Readout label="Routes served" note="this build answers them">
            <span className="tnum font-display text-[40px] font-bold leading-none text-up">{counts.open}</span>
          </Readout>
          <Readout label="Served, with gaps" note="named on each route">
            <span className="tnum font-display text-[40px] font-bold leading-none text-warn-ink">{counts.partial}</span>
          </Readout>
          <Readout label="Being surveyed" note="specified, not served yet">
            <span className="tnum font-display text-[40px] font-bold leading-none text-ink-2">{counts.surveying}</span>
          </Readout>
        </Cards>
      </Section>

      <Section id="console" tag="Field console · ask, read" title="Ask the API. Ely reads the answer." lede="Pick a safe GET and send it from your browser. Ely climbs while it asks, plants the flag on an answer, holds on through a refusal and falls asleep when nobody is home.">
        <FieldConsole results={results} />
      </Section>

      <Section id="routes" tag="The API · by altitude" title="Every route, filed where it lives." lede="The sign says whether this build serves it; the line under it is what the API told your browser a moment ago.">
        <TrailProfile groups={MANUAL} />
        <div className="mt-12 flex flex-col gap-10">
          {ordered.map((group) => (
            <ManualGroup key={group.altitude} group={group} results={results} />
          ))}
        </div>
      </Section>

      <Section id="cards" tag="Snippet cards · copy, paste, climb" title="Four cards to start with." lede="Types come from @elyia/core/api/*, the same contracts the app is built on; a packaged SDK follows once every route above is served.">
        <Cards n={2}>
          {cards.map((snippet, index) => (
            <SnippetCard key={snippet.id} snippet={snippet} index={index} />
          ))}
        </Cards>
      </Section>

      <Section id="rules" tag="Rules of the range · four" title="What the API will never do.">
        <Cards n={4} as="ol" phone={1}>
          {RULES.map(([title, body], index) => (
            <li key={title} className="flex h-full flex-col items-center gap-3 bg-card px-5 pb-6 pt-5 text-center px-frame px-drop">
              <span className={cx("flex h-10 w-10 items-center justify-center font-display text-[20px] font-bold px-frame-thin", index === 0 ? "bg-signal text-[#16201B]" : "bg-paper text-ink")}>{index + 1}</span>
              <h3 className="font-display text-[20px] font-bold leading-tight text-ink">{title}</h3>
              <p className="text-[14px] leading-snug text-ink-2">{body}</p>
            </li>
          ))}
        </Cards>
        <figure className="mx-auto mt-14 max-w-[800px] bg-card px-frame px-drop-lg">
          <figcaption className="flex flex-col items-center gap-1 px-4 py-4 text-center">
            <span className="font-tag text-[12px] uppercase text-ink">The error envelope · every refusal looks like this</span>
            <span className="font-tag text-[10px] uppercase text-ink-2">4xx · 5xx</span>
          </figcaption>
          <pre className={cx("m-0 whitespace-pre-wrap break-words border-t-2 border-rule px-5 py-4 font-mono text-[12px] leading-[1.6]", SCREEN)} tabIndex={0} aria-label="Error envelope example">
            {ERROR_EXAMPLE}
          </pre>
          <p className="px-5 py-3 text-center font-mono text-[11px] leading-relaxed text-ink-2">
            Rate limits per IP; heavy routes cost more. HyperCore allows 1,200 weight a minute per IP, so per-user live streams belong in the user&apos;s own browser.
          </p>
        </figure>
      </Section>
    </Page>
  );
}
