import type { PortalGlyphName } from "../portal/glyphs";
import { Card, Glyph, SectionHead } from "../portal/ui";

const WAYS: ReadonlyArray<{ readonly glyph: PortalGlyphName; readonly title: string; readonly body: string; readonly code: string }> = [
  { glyph: "grid", title: "Intent apps", body: "One sentence in, a priced multi-leg route out. Prepare unsigned txs; your user signs.", code: "POST /v1/intents" },
  { glyph: "plug", title: "Agents over MCP", body: "Give any agent Ely's tools: markets, venues, shield, plan. It drafts; humans sign.", code: "POST /v1/mcp" },
  { glyph: "widget", title: "Drop-in widget", body: "The Ask Ely box in your site, themed to you, carrying your integrator fee.", code: "GET /v1/widget/:id" },
  { glyph: "hook", title: "Bots and alerts", body: "Signed webhooks when a step settles, an alert fires or a protocol launches.", code: "intent.step.settled" },
];

export function WaysIn() {
  return (
    <section id="ways" aria-labelledby="ways-title" className="scroll-mt-28 border-t-2 border-dashed border-rule pt-14 mt-14">
      <SectionHead id="ways-title" tag="What you can build" title="Four ways in." />
      <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {WAYS.map((way) => (
          <li key={way.title} className="flex">
            <Card className="portal-lift flex flex-1 flex-col gap-3">
              <Glyph name={way.glyph} scale={3} />
              <h3 className="font-display text-[17px] font-bold text-ink">{way.title}</h3>
              <p className="flex-1 text-[12.5px] leading-relaxed text-ink-2">{way.body}</p>
              <code className="font-mono text-[11.5px] text-accent">{way.code}</code>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
