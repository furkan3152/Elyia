/**
 * Minimal SSE reader over fetch (works in Node 20+ and browsers, and for
 * POST streams such as Ely's chat, which EventSource cannot open).
 */

export interface SseMessage<T = unknown> {
  readonly event: string;
  readonly data: T;
  readonly id: string | null;
}

/** Splits an SSE byte stream into messages; `data` is JSON-parsed when it parses. */
export async function* readSse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const message = parseBlock(block);
        if (message) yield message;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseBlock(block: string): SseMessage | null {
  let event = "message";
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":") || line.length === 0) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /u, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (data.length === 0) return null;
  const raw = data.join("\n");
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON: keep the text.
  }
  return { event, data: parsed, id };
}
