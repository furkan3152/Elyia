import { MCP_TOOL_NAMES } from "@elyia/core/api/developers";

import { API_BASE } from "../../../lib/env";
import { Button } from "../../../ui/Button";
import { copyText } from "../../../ui/clipboard";
import { toast } from "../../../ui/toast";
import { mcpSnippet, quickstartSnippet } from "../devModel";
import { Card, Code, CodeHead, Pill, SectionHead } from "../portal/ui";

function CopyButton({ text, what }: { readonly text: string; readonly what: string }) {
  return (
    <Button variant="ink" size="xs" onClick={() => void copyText(text).then((ok) => (ok ? toast.success(`${what} copied`) : toast.error("Copy failed: select the text instead")))}>
      Copy
    </Button>
  );
}

/** Quickstart over @elyia/sdk (the typed client in packages/sdk) | the MCP config and its tools. */
export function SdkMcp() {
  const quick = quickstartSnippet(API_BASE);
  const mcp = mcpSnippet(API_BASE);
  return (
    <section id="sdk" aria-labelledby="sdk-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="sdk-title" tag="Quickstart and MCP" title="Three calls to a route. One URL to an agent." lede="The typed @elyia/sdk client: plan, prepare, your user's wallet signs, submit, follow the journey. Keys stay on your server." />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="flex flex-col">
          <CodeHead left="TypeScript · @elyia/sdk" right={<span className="normal-case">packages/sdk · not on npm yet</span>} />
          <Code text={quick} className="h-[340px] flex-1" label="Quickstart code" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-3">Node 20+, Workers or the browser (keys server-side only). Testnet: chain 99801.</span>
            <CopyButton text={quick} what="Quickstart" />
          </div>
        </div>
        <div id="mcp" className="flex scroll-mt-28 flex-col">
          <CodeHead left="MCP · any client" right="stateless · Streamable HTTP" />
          <Code text={mcp} className="h-[188px]" label="MCP client configuration" />
          <div className="mt-3 flex justify-end">
            <CopyButton text={mcp} what="MCP config" />
          </div>
          <Card flat className="mt-3 flex-1 p-4">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <span className="font-tag text-[10px] uppercase tracking-[0.06em] text-ink-2">{MCP_TOOL_NAMES.length} tools · it never signs</span>
              <Pill tone="up">read + draft</Pill>
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {MCP_TOOL_NAMES.map((tool) => (
                <li key={tool} className={tool === "create_signing_link" ? "bg-accent/15 px-2 py-1 font-mono text-[11px] text-accent px-frame-thin px-tone-accent" : "bg-paper px-2 py-1 font-mono text-[11px] text-ink-2 px-frame-thin"}>
                  {tool}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
              <b className="text-ink-2">create_signing_link</b> is how an agent hands a draft to a human: a link that opens the route card in Elyia, where the person's wallet signs.
            </p>
          </Card>
        </div>
      </div>
    </section>
  );
}
