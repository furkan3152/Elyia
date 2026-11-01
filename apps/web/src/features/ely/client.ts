/**
 * The chat client: `POST /v1/agent/chat` read as a stream (fetch + the SSE
 * parser, since EventSource cannot POST). Every event is validated before
 * it is handed on; the caller aborts with its signal. No key, no signing:
 * the server answers with proposals the user signs in their own wallet.
 */
import type { ChatRequest } from "@elyia/core/api/agent";
import { SESSION_HEADER } from "@elyia/core/api/ops";

import { apiUrl } from "../../lib/api";
import { errorFromResponse } from "../../lib/apiErrors";
import { parseElyEvent, type ElyEvent } from "./events";
import { createSseParser } from "./sseParse";

export interface StreamChatInput {
  readonly request: ChatRequest;
  readonly session?: string | null;
  readonly signal?: AbortSignal;
  readonly onEvent: (event: ElyEvent) => void;
}

/** Resolves when the stream ends (normally or not); rejects with an ApiError on a refused request. */
export async function streamChat({ request, session, signal, onEvent }: StreamChatInput): Promise<void> {
  const response = await fetch(apiUrl("/v1/agent/chat"), {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json", ...(session ? { [SESSION_HEADER]: session } : {}) },
    body: JSON.stringify(request),
    signal,
    credentials: "omit",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // plain text error body
    }
    throw errorFromResponse(response.status, body, response.headers.get("retry-after"));
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser((message) => {
    const event = parseElyEvent(message.event, message.data);
    if (event) onEvent(event);
  });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}
