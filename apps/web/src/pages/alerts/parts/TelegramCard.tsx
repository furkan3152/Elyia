import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, apiPost } from "../../../lib/api";
import { Ely } from "../../../pixel/Ely";
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
    <section className="flex h-full flex-col bg-card px-frame px-drop" aria-labelledby="tg-title">
      <header className="flex items-center justify-between gap-3 border-b-2 border-rule bg-paper-2 px-4 py-2.5">
        <h3 id="tg-title" className="font-tag text-[12px] uppercase text-ink">
          Telegram · base-camp radio
        </h3>
        <span className={cx("flex items-center gap-1.5 font-tag text-[11px] uppercase", code ? "text-up" : "text-ink-2")}>
          <span aria-hidden="true" className={cx("inline-block h-2 w-2", code ? "bg-up" : "bg-ink-3/40")} />
          {code ? "code ready" : "not linked"}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-5 px-5 py-5">
        <p className="text-[15px] leading-snug text-ink-2">
          Alerts and Ely&apos;s proposals in Telegram, with the buttons in the message. <span className="font-semibold text-ink">Approving opens Elyia to sign</span>; the bot never holds a key.
        </p>
        <figure className="el-day m-0 flex items-end gap-3" aria-label="Preview of a Telegram alert">
          <Ely state="talk" size={56} label={null} className="shrink-0" />
          <div className="relative min-w-0 flex-1 bg-[#EAF4F7] p-3 text-[#16201B] px-frame-thin">
            <p className="font-tag text-[10px] uppercase text-[#3E4A44]">Elyia radio · preview</p>
            <p className="mt-1 text-[14px] leading-snug">
              <span className="font-semibold">ALERT → you</span> · {preview}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 font-tag text-[10px] uppercase">
              <span className="bg-white px-2 py-1 text-center px-frame-thin">Open the Guide</span>
              <span className="bg-white px-2 py-1 text-center px-frame-thin">Mute 1 h</span>
            </div>
          </div>
        </figure>
        {code ? (
          <div className="mt-auto flex flex-col items-center gap-3 bg-paper-2 px-3 py-4 text-center px-frame-thin">
            <p className="font-tag text-[11px] uppercase text-ink-3">One-time code{code.expiresAt ? ` · expires ${new Date(code.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            <p className="tnum font-display text-[32px] font-bold tracking-[0.2em] text-ink">{code.code}</p>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-4">
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
          <div className="mt-auto flex flex-col items-center gap-4 text-center">
            <Button variant="primary" size="md" loading={link.isPending} onClick={() => link.mutate()}>
              Get a link code
            </Button>
            {offline ? (
              <p role="status" className="bg-paper-2 px-3 py-2 text-left text-[13px] leading-snug text-ink-2 px-frame-thin px-tone-signal">
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
