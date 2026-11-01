/**
 * An incremental text/event-stream parser (pure). `POST /v1/agent/chat`
 * answers with SSE, and EventSource cannot POST, so the client reads the
 * body with fetch and feeds the decoded chunks here. Follows the WHATWG
 * rules that matter: `event`, `data` (multi-line joined with "\n"), `id`,
 * comment lines, CRLF / CR / LF line ends, a blank line dispatches, and a
 * message without data is dropped.
 */

export interface SseMessage {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

export interface SseParser {
  /** Feed the next decoded chunk (may split a line or a message anywhere). */
  push(chunk: string): void;
  /** The stream ended: dispatch a final message that had no trailing blank line. */
  end(): void;
}

export function createSseParser(onMessage: (message: SseMessage) => void): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | null = null;
  let sawCr = false;

  const dispatch = () => {
    if (data.length > 0) onMessage({ event: event || "message", data: data.join("\n"), id });
    event = "";
    data = [];
  };

  const line = (text: string) => {
    if (text === "") {
      dispatch();
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id" && !value.includes("\u0000")) id = value;
  };

  return {
    push(chunk) {
      let text = chunk;
      // A CRLF split across chunks: the LF of the previous CR is not a second line end.
      if (sawCr && text.startsWith("\n")) text = text.slice(1);
      sawCr = false;
      buffer += text;
      let start = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        const char = buffer[index];
        if (char !== "\n" && char !== "\r") continue;
        line(buffer.slice(start, index));
        if (char === "\r") {
          if (index + 1 < buffer.length) {
            if (buffer[index + 1] === "\n") index += 1;
          } else {
            sawCr = true;
          }
        }
        start = index + 1;
      }
      buffer = buffer.slice(start);
    },
    end() {
      if (buffer !== "") line(buffer);
      buffer = "";
      dispatch();
    },
  };
}
