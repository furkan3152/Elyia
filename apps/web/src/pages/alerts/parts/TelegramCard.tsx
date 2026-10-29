import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, apiPost } from "../../../lib/api";
import { Button } from "../../../ui/Button";
import { buttonClasses } from "../../../ui/buttonStyles";
import { copyText } from "../../../ui/clipboard";
import { cx } from "../../../ui/cx";
import { toast } from "../../../ui/toast";

interface LinkCode {
  readonly code: string;
  readonly url: string | null;
  readonly expiresAt: number | null;
}

/** Reads whatever shape the API answers with ({code, url|deepLink|link, expiresAt}). */
function linkFrom(body: unknown): LinkCode | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : null;
  if (!code) return null;
  const url = [record.url, record.deepLink, record.link].find((value): value is string => typeof value === "string" && /^https:\/\/t\.me\//u.test(value)) ?? null;
  const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : typeof record.expiresAt === "string" ? Date.parse(record.expiresAt) || null : null;
  return { code, url, expiresAt };
}

/**
 * The Telegram link: a one-time code from the API that the bot reads from a
 * deep link (t.me/<bot>?start=<code>). Until the bot is online it says so,
 * and shows how a radio message will look.
 */
export function TelegramCard({ preview }: { readonly preview: string }) {
  const [offline, setOffline] = useState<string | null>(null);
  const link = useMutation({
    mutationFn: () => apiPost<unknown>("/v1/telegram/link-code", {}, { timeoutMs: 8_000 }),
    onSuccess: (body) => {
      if (!linkFrom(body)) setOffline("The API answered without a link code.");
    },
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : "";
      setOffline(code === "NETWORK_ERROR" || code === "TIMEOUT" ? "The Elyia API is not answering." : "The Telegram bot is not online on this server yet.");
    },
  });
  const code = link.data ? linkFrom(link.data) : null;

  return (
    <section className="border-2 border-rule bg-card shadow-hard" aria-labelledby="tg-title">
      <header className="flex items-center justify-between gap-3 border-b-1.5 border-rule px-4 py-2">
        <h2 id="tg-title" className="caption !text-ink">
          Telegram · base-camp radio
        </h2>
        <span className={cx("flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em]", code ? "text-up" : "text-ink-2")}>
          <span aria-hidden="true" className={cx("h-2 w-2 rotate-45", code ? "bg-up" : "border-1.5 border-rule/60")} />
          {code ? "code ready" : "not linked"}
        </span>
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">
        <p className="text-[15px] leading-snug text-ink-2">
          Alerts and the Guide&apos;s proposals in Telegram, with the buttons in the message. <span className="font-semibold text-ink">Approving opens Elyia to sign</span>; the bot never holds a key.
        </p>
        <figure className="el-day relative ml-2 max-w-[340px] border-2 border-rule bg-[#EAF4F7] p-2.5 text-[#16201B]" aria-label="Preview of a Telegram alert">
          <span aria-hidden="true" className="absolute -left-[9px] bottom-2 h-3 w-3 rotate-45 border-b-2 border-l-2 border-rule bg-[#EAF4F7]" />
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#3E4A44]">Elyia radio · preview</p>
          <p className="mt-1 text-[14px] leading-snug">
            <span className="font-semibold">ALERT → you</span> · {preview}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]">
            <span className="border-1.5 border-[#16201B] bg-white px-2 py-1 text-center">Open the Guide</span>
            <span className="border-1.5 border-[#16201B] bg-white px-2 py-1 text-center">Mute 1 h</span>
          </div>
        </figure>
        {code ? (
          <div className="flex flex-col gap-2 border-2 border-dashed border-rule px-3 py-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">One-time code{code.expiresAt ? ` · expires ${new Date(code.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            <p className="tnum font-mono text-[28px] font-semibold tracking-[0.2em] text-ink">{code.code}</p>
            <div className="flex flex-wrap gap-2">
              {code.url ? (
                <a href={code.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", size: "sm" })}>
                  Open in Telegram ▸
                </a>
              ) : null}
              <Button variant="ink" size="sm" onClick={() => void copyText(code.url ?? code.code).then((ok) => ok && toast.success("Copied", { description: "Paste it to the bot." }))}>
                Copy {code.url ? "link" : "code"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="md" loading={link.isPending} onClick={() => link.mutate()}>
              Get a link code
            </Button>
            {offline ? (
              <p role="status" className="border-l-[3px] border-warn bg-paper-2 px-3 py-2 text-[13px] leading-snug text-ink-2">
                <span className="font-semibold text-ink">Coming online.</span> {offline} Your alerts still fire here, in this feed; they reach Telegram once the bot is linked.
              </p>
            ) : (
              <p className="font-mono text-[11px] text-ink-3">t.me/&lt;bot&gt;?start=&lt;code&gt; · the code links this browser&apos;s alerts to your chat</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
