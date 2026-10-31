/**
 * Turkish case suffixes. A suffix after an apostrophe ("ETH'de",
 * "HYPE'ı", "Elysium'a", "USDC'ye", "60'ın", "100 USDC'lik") gives the word a
 * role; the same suffixes glued to a known name without an apostrophe
 * ("elysiuma") are read only when the rest of the word is a known name.
 * Suffixes are matched on the folded form (ı->i, ü->u, ö->o, ş->s, ç->c, ğ->g).
 */
import type { Role } from "./types.js";

/** Folded suffix -> role. Plural, possessive and buffer letters are part of the listed forms. */
const SUFFIX_ROLES: ReadonlyArray<readonly [RegExp, Role]> = [
  // ablative: 'dan 'den 'tan 'ten, with possessive/buffer forms
  [/^(?:n|s?in|s?un|lar|ler|larim|lerim|im|um|imiz|umuz)?(?:dan|den|tan|ten)$/u, "from"],
  // locative
  [/^(?:n|s?in|s?un|lar|ler|larim|lerim|im|um)?(?:da|de|ta|te)(?:ki)?$/u, "on"],
  // instrumental
  [/^(?:y)?(?:la|le)$/u, "with"],
  // -lık / -lik / -luk / -lük ("100 USDC'lik", "200 dolarlık")
  [/^(?:lik|luk|lık|lük)(?:la|le)?$/u, "worth"],
  // genitive ("60'ın", "HYPE'ın", "BTC'nin")
  [/^(?:im|um|imiz|umuz|s)?(?:n)?(?:in|un)$|^(?:nin|nun)$/u, "gen"],
  // dative: 'a 'e 'ya 'ye 'na 'ne, with plural/possessive forms
  [/^(?:lar|ler|larim|lerim|im|um|s?in|s?un|imiz)?(?:y|n)?(?:a|e)$/u, "to"],
  // accusative: 'ı 'i 'u 'ü 'yı 'yi 'yu 'yü 'nı 'ni, with plural/possessive forms
  [/^(?:lar|ler|larim|lerim|im|um|imiz|umuz|si|su|s|m|i|u)?(?:y|n)?(?:i|u)$/u, "obj"],
  // bare plural / possessive ("HYPE'larım", "ETH'im"): no role
];

const PLAIN = /^(?:lar|ler|larim|lerim|im|um|imiz|umuz|in|un|m)$/u;

/** The role of a folded suffix, `null` for a known roleless suffix (plural, possessive), `undefined` when it is not a Turkish suffix. */
export function suffixRole(suffix: string): Role | null | undefined {
  const folded = suffix.toLowerCase();
  for (const [pattern, role] of SUFFIX_ROLES) if (pattern.test(folded)) return role;
  if (PLAIN.test(folded)) return null;
  return undefined;
}

/** Folded word = known stem + Turkish suffix (no apostrophe): the stem length options, longest stem first. */
export function stemSplits(folded: string): Array<{ readonly stem: string; readonly role: Role | null }> {
  const out: Array<{ stem: string; role: Role | null }> = [];
  for (let cut = folded.length - 1; cut >= 2; cut -= 1) {
    const role = suffixRole(folded.slice(cut));
    if (role !== undefined) out.push({ stem: folded.slice(0, cut), role });
  }
  return out;
}

/** Letters that only Turkish uses (dotless ı, ğ, ş, İ). */
export const TURKISH_LETTERS = /[ığşİĞŞ]/u;
/** Letters common in Turkish and rare in English commands. */
export const TURKISH_LIKELY = /[çöüÇÖÜ]/u;
