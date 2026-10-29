import { cx } from "../ui/cx";
import { SOFT_TONE } from "../ui/tones";
import { toneForToken } from "./chipTone";
import type { PreviewToken } from "./preview";

export interface IntentChipsProps {
  readonly tokens: readonly PreviewToken[];
  readonly className?: string;
}

/** The coloured chip row under an intent: what Elyia heard, by role. */
export function IntentChips({ tokens, className }: IntentChipsProps) {
  if (tokens.length === 0) return null;
  return (
    <ul className={cx("flex flex-wrap gap-1.5", className)} aria-label="What Elyia heard">
      {tokens.map((token, index) => (
        <li key={`${token.text}-${index}`} className={cx("rounded-lg border px-2.5 py-1 font-mono text-xs", SOFT_TONE[toneForToken(token)])}>
          <span className="sr-only">{token.kind}: </span>
          {token.text.replace(/[,;]+$/u, "")}
        </li>
      ))}
    </ul>
  );
}
