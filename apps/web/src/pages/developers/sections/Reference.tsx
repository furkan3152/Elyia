import { WEBHOOK_EVENT_TYPES, WEBHOOK_HEADERS, WEBHOOK_TOLERANCE_SECONDS } from "@elyia/core/api/developers";

import { cx } from "../../../ui/cx";
import { AUTH_WORDS, CHANGELOG, COMMON_ERRORS, countRoutes, ERROR_ENVELOPE, EVENT_NOTES, REST } from "../reference";
import { Card, CardHead, Code, SectionHead } from "../portal/ui";

const METHOD_TONE: Readonly<Record<string, string>> = { GET: "text-up", POST: "text-accent", PUT: "text-warn-ink", PATCH: "text-warn-ink", DELETE: "text-down", SSE: "text-ridge" };

export function Reference() {
  return (
    <section id="rest" aria-labelledby="ref-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="ref-title" tag={`Reference · ${countRoutes()} routes shown`} title="The map key." lede="Every route answers JSON, every error the same envelope. Full contracts are typed in @elyia/core/api/*." />
      <Card className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-3">
          {REST.map((group, index) => (
            <div key={group.title} className={cx("p-5", index > 0 && "border-t-2 border-dashed border-rule lg:border-l-2 lg:border-t-0")}>
              <h3 className="mb-3 font-tag text-[11px] uppercase tracking-[0.08em] text-ink-2">{group.title}</h3>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {group.rows.map((row) => (
                  <li key={row.path} className="text-[12px]">
                    <div className="flex items-baseline gap-2">
                      <span className={cx("w-[44px] shrink-0 font-tag text-[10px] uppercase", METHOD_TONE[row.method])}>{row.method}</span>
                      <code className="min-w-0 break-all font-mono text-[11.5px] text-ink">{row.path}</code>
                    </div>
                    <div className="ml-[52px] text-[11.5px] text-ink-3">
                      {row.what} · <span className="text-ink-2">{AUTH_WORDS[row.auth]}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card id="events" className="flex scroll-mt-28 flex-col">
          <CardHead glyph="bolt" title="Events" />
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[11.5px]">
            {WEBHOOK_EVENT_TYPES.map((type) => (
              <li key={type}>
                <code className="font-mono text-ink">{type}</code>
                <div className="text-ink-3">{EVENT_NOTES[type]}</div>
              </li>
            ))}
          </ul>
          <p className="mt-auto pt-3 text-[11px] text-ink-3">
            Header <code className="text-ink-2">{WEBHOOK_HEADERS.signature}</code>; tolerance {WEBHOOK_TOLERANCE_SECONDS / 60} min.
          </p>
        </Card>
        <Card id="errors" className="flex scroll-mt-28 flex-col">
          <CardHead glyph="eye" title="Errors" />
          <Code text={ERROR_ENVELOPE} className="text-[10.5px]" label="Error envelope" />
          <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-[11px]">
            {COMMON_ERRORS.map(([code, status, what]) => (
              <li key={code}>
                <code className="text-ink">{code}</code> <span className="text-ink-3">{status} · {what}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card id="rulebook" className="flex scroll-mt-28 flex-col gap-2.5">
          <CardHead glyph="book" title="Rule Book" />
          <p className="text-[12px] leading-relaxed text-ink-2">Every plan passes the Rule Book before a wallet sees it. It fails closed: an unpriced token, a stale quote or a cap breach stops the route with a reason, never a silent guess.</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11.5px] text-ink-2">
            <li>▸ unpriced tokens are never valued</li>
            <li>▸ quotes expire; prepare re-quotes</li>
            <li>▸ nothing the API returns is signed</li>
          </ul>
        </Card>
        <Card id="changelog" className="flex scroll-mt-28 flex-col">
          <CardHead glyph="clock" title="Changelog" />
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0 text-[11.5px]">
            {CHANGELOG.map(([when, what]) => (
              <li key={what}>
                <span className="font-tag text-[10px] uppercase text-accent">{when}</span>
                <div className="text-ink-2">{what}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </section>
  );
}
