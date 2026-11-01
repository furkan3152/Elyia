/** The Rule Book a route was checked against, as the route card's stub prints it. */
import { DEFAULT_RULE_BOOK, ruleBookHash } from "@elyia/core/policy";

/** The hash of the built-in Rule Book (what a route bound to the defaults shows). */
export const DEFAULT_RULE_BOOK_HASH = ruleBookHash(DEFAULT_RULE_BOOK);

/** "default Rule Book · sha256:005b17f6…", or "your Rule Book · …" for any other hash. */
export function ruleBookLine(hash: string): string {
  const short = /^sha256:[0-9a-f]{8,}/u.test(hash) ? `${hash.slice(0, 15)}…` : hash;
  return `${hash === DEFAULT_RULE_BOOK_HASH ? "default Rule Book" : "your Rule Book"} · ${short}`;
}

