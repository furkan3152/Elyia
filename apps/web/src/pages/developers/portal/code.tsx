/** Typed reveal and the lit-screen colouring for portal code blocks. */
import React, { useEffect, useState } from "react";

/** Reveals `text` at `cps` characters per second (0: at once). Restarts when the text changes. */
export function useTyped(text: string, cps: number): string {
  const [typed, setTyped] = useState<{ readonly text: string; readonly count: number }>({ text, count: 0 });
  useEffect(() => {
    if (cps <= 0) return undefined;
    const started = performance.now();
    let handle = 0;
    const step = () => {
      const count = Math.min(text.length, Math.floor(((performance.now() - started) / 1000) * cps));
      setTyped({ text, count });
      if (count < text.length) handle = window.setTimeout(step, 33);
    };
    handle = window.setTimeout(step, 33);
    return () => window.clearTimeout(handle);
  }, [text, cps]);
  if (cps <= 0) return text;
  return typed.text === text ? text.slice(0, typed.count) : "";
}

/** Minimal JSON / JS colouring for the lit screen: strings sun-pale, numbers aqua, keys glacier-light, comments muted. */
export function colourise(source: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /("(?:[^"\\]|\\.)*"(?=\s*:))|("(?:[^"\\]|\\.)*")|(\/\/[^\n]*)|\b(\d+(?:\.\d+)?|true|false|null)\b|\b(import|from|const|await|new|for|of|export|return)\b/gu;
  let last = 0;
  let index = 0;
  for (const match of source.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(source.slice(last, at));
    const [whole, key, string, comment, number, keyword] = match;
    const colour = key ? "#8FD3E0" : string ? "#F6DA72" : comment ? "#7F948C" : number ? "#7FE0B5" : keyword ? "#FF9E8F" : undefined;
    out.push(
      <span key={index++} style={{ color: colour }}>
        {whole}
      </span>,
    );
    last = at + whole.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

