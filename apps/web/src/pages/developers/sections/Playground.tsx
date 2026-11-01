import type { CreateIntentResponse } from "@elyia/core/api/intents";
import type { ParseIntentResponse } from "@elyia/core/api/language";
import { useCallback, useEffect, useRef, useState } from "react";

import { shortAddress } from "../../../features/session";
import { describeError } from "../../../lib/api";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { parseIntent, planDryRun, type Timed } from "../devApi";
import { bpsToPercent } from "../devModel";
import { consoleJson, integratorFeeUsd, planAccount, userCard } from "../playgroundModel";
import { Card, CardHead, Code, CodeHead, Pill, SectionHead } from "../portal/ui";
import { RouteStrip } from "../RouteStrip";

/** Sentences the reader answers `ready` (from GET /v1/language/examples). */
const EXAMPLES = ["swap 50 HYPE to USDC on Elysium", "bridge 20 HYPE to Elysium and swap half to USDC on kalos", "long ETH 5x with 200 USDC, stop at 3% below entry"];

type Run =
  | { readonly state: "idle" }
  | { readonly state: "running"; readonly endpoint: string }
  | { readonly state: "done"; readonly endpoint: string; readonly ms: number; readonly json: string; readonly parse: ParseIntentResponse | null; readonly plan: CreateIntentResponse | null; readonly note: string | null }
  | { readonly state: "failed"; readonly endpoint: string; readonly error: string };

export function Playground({ address, feeBps, project }: { readonly address: string | null; readonly feeBps: number; readonly project: string }) {
  const [text, setText] = useState(EXAMPLES[0]!);
  const [run, setRun] = useState<Run>({ state: "idle" });
  const [runs, setRuns] = useState(0);
  const account = planAccount(address);
  const ran = useRef(false);

  const go = useCallback(async () => {
    const sentence = text.trim();
    if (!sentence) return;
    setRuns((n) => n + 1);
    setRun({ state: "running", endpoint: "POST /v1/intents/parse" });
    let parsed: Timed<ParseIntentResponse>;
    try {
      parsed = await parseIntent(sentence);
    } catch (error) {
      setRun({ state: "failed", endpoint: "POST /v1/intents/parse", error: describeError(error) });
      return;
    }
    if (parsed.body.status === "ready" && account) {
      setRun({ state: "running", endpoint: "POST /v1/intents · dryRun" });
      try {
        const planned: Timed<CreateIntentResponse> = await planDryRun(parsed.body.canonical ?? sentence, account);
        setRun({ state: "done", endpoint: "POST /v1/intents · dryRun", ms: planned.ms, json: consoleJson(planned.body), parse: parsed.body, plan: planned.body, note: null });
        return;
      } catch (error) {
        setRun({ state: "done", endpoint: "POST /v1/intents/parse", ms: parsed.ms, json: consoleJson(parsed.body), parse: parsed.body, plan: null, note: `The dry-run plan did not complete: ${describeError(error)}` });
        return;
      }
    }
    setRun({
      state: "done",
      endpoint: "POST /v1/intents/parse",
      ms: parsed.ms,
      json: consoleJson(parsed.body),
      parse: parsed.body,
      plan: null,
      note: parsed.body.status === "unreadable" ? "Ely could not read that sentence; the response lists examples." : parsed.body.status !== "ready" ? "Ely needs an answer before this can be planned (see questions)." : account ? null : "Sign in to price it with a dry-run plan from your address.",
    });
  }, [text, account]);

  // One live reading when the playground first mounts: the API answers, not a canned sample.
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void go();
  }, [go]);

  const card = run.state === "done" ? userCard(run.parse, run.plan) : null;
  const fee = card ? integratorFeeUsd(card, feeBps) : null;
  const status = run.state === "done" ? `200 OK · ${run.ms} ms` : run.state === "running" ? "waiting…" : run.state === "failed" ? "no answer" : "ready";

  return (
    <section id="playground" aria-labelledby="playground-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="playground-title" tag="Playground · live" title="Plan an intent. See what your users see." lede="This calls the real API. A reading is public; a priced dry run uses your signed-in address and stores nothing." />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void go();
            }}
          >
            <label htmlFor="pg-intent" className="font-tag text-[10px] uppercase tracking-[0.06em] text-ink-2">
              Intent
            </label>
            <input id="pg-intent" value={text} maxLength={500} onChange={(event) => setText(event.target.value)} className="h-11 bg-paper px-3 font-mono text-[13px] text-ink outline-none px-frame-thin focus-visible:outline-dashed focus-visible:outline-4 focus-visible:outline-offset-[4px] focus-visible:outline-signal" />
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="acc" dot>
                Elysium testnet
              </Pill>
              <Pill tone={account ? "mute" : "warn"}>{account ? `from ${shortAddress(address)}` : "no wallet · reading only"}</Pill>
              <span className="flex-1" />
              <Button variant="primary" size="sm" type="submit" loading={run.state === "running"}>
                Run ▸
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => setText(example)} className={cx("bg-paper-2 px-2 py-1 text-left text-[11px] text-ink-2 hover:bg-paper-3 px-frame-thin", "focus-visible:outline-dashed focus-visible:outline-4 focus-visible:outline-offset-[4px] focus-visible:outline-signal")}>
                  {example}
                </button>
              ))}
            </div>
          </form>
          <div className="flex flex-1 flex-col">
            <CodeHead left={run.state === "idle" ? "POST /v1/intents/parse" : run.endpoint} right={status} rightTone={run.state === "done" ? "ok" : run.state === "failed" ? "warn" : "mute"} />
            {run.state === "done" ? (
              <Code key={runs} text={run.json} typeCps={420} className="h-[300px]" label="API response" />
            ) : run.state === "failed" ? (
              <pre className="m-0 h-[300px] overflow-auto bg-[#16201B] px-4 py-3 font-mono text-[12px] text-[#F6DA72]">{`The API did not answer.\n\n${run.error}\n\nStart it with: npm run dev -w @elyia/api`}</pre>
            ) : (
              <pre aria-busy="true" className="m-0 h-[300px] bg-[#16201B] px-4 py-3 font-mono text-[12px] text-[#9FB8B0]">
                {"// asking Ely…"}
              </pre>
            )}
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <CardHead glyph="eye" title="What your users see" right={<Pill tone="acc">live preview</Pill>} />
          <div className="flex flex-col gap-3 bg-paper p-4 px-frame-thin">
            <div className="flex items-baseline justify-between gap-3">
              <b className="min-w-0 truncate font-display text-[16px] text-ink">{card?.title ?? (run.state === "failed" ? "No route: the API is unreachable" : run.state === "done" ? "Ely could not read that yet. Try an example." : "Surveying the route…")}</b>
              <span className="shrink-0 font-tag text-[10px] uppercase text-ink-2">{card?.where ?? "—"}</span>
            </div>
            <RouteStrip label={card ? `Route strip: ${card.where}` : "Route strip, waiting for a reading"} playKey={runs} />
            <div className="grid grid-cols-3 gap-2">
              {[
                ["You send", card?.send ?? "—"],
                ["You get", card?.get ?? "—"],
                ["Venue", card?.venue ?? (card && !card.priced ? "priced at plan" : "—")],
              ].map(([k, v]) => (
                <div key={k} className="bg-card p-2 text-center px-frame-thin">
                  <div className="font-tag text-[9.5px] uppercase text-ink-3">{k}</div>
                  <div className="mt-1 truncate font-mono text-[12px] text-ink tnum">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12px] text-ink-2">
                {feeBps > 0 ? (
                  <>
                    Includes {bpsToPercent(feeBps)}
                    {fee !== null ? ` ($${fee.toFixed(2)})` : ""} to <b className="text-ink">{project}</b>
                  </>
                ) : (
                  "No integrator fee."
                )}
              </span>
              <span className="flex-1" />
              <Button variant="primary" size="sm" disabled title="Your app's button: the user's wallet signs">
                Sign in your app
              </Button>
            </div>
          </div>
          {run.state === "done" && run.note ? <p className="text-[12px] text-warn-ink">{run.note}</p> : null}
          {run.state === "done" && run.parse && run.parse.questions.length > 0 ? (
            <div className="bg-paper p-3 text-[12px] px-frame-thin">
              <div className="mb-1 font-tag text-[10px] uppercase text-ink-3">Ely asks</div>
              {run.parse.questions.map((question) => (
                <p key={question.id} className="text-ink">
                  {question.prompt}
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-auto bg-paper p-3 text-[12px] px-frame-thin">
            <div className="mb-2 font-tag text-[10px] uppercase tracking-[0.06em] text-ink-3">Then, in order</div>
            <ol className="m-0 grid list-none grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 p-0">
              {[
                ["POST /v1/intents/:id/steps/:sid/prepare", "unsigned tx"],
                ["wallet signs + sends", "user"],
                ["webhook intent.step.settled", "receipt"],
              ].map(([what, who], index) => (
                <li key={what} className="contents">
                  <span className="font-mono text-accent">{index + 1}</span>
                  <span className="min-w-0 truncate font-mono text-ink">{what}</span>
                  <span className="text-ink-3">{who}</span>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      </div>
    </section>
  );
}
