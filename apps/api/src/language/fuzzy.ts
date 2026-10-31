/**
 * Deterministic typo matching against a closed vocabulary
 * (optimal-string-alignment Damerau-Levenshtein). A word is corrected only
 * when exactly one vocabulary word is closest within its threshold; a tie
 * returns several candidates (the reader asks), never a guess.
 *
 * Thresholds: under 4 characters, never; 4-6 characters, distance 1;
 * 7 or more, distance 2.
 */
export function distance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const d: number[][] = Array.from({ length: s.length + 1 }, () => new Array<number>(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i += 1) (d[i] as number[])[0] = i;
  for (let j = 0; j <= t.length; j += 1) (d[0] as number[])[j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    const row = d[i] as number[];
    const prev = d[i - 1] as number[];
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        row[j] = Math.min(row[j] as number, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
    }
  }
  return (d[s.length] as number[])[t.length] as number;
}

export function threshold(word: string): number {
  if (word.length < 4) return 0;
  return word.length >= 7 ? 2 : 1;
}

/** Closest vocabulary words within the threshold (vocabulary order); empty when none, several on a tie. */
export function candidates(word: string, vocabulary: Iterable<string>): string[] {
  const limit = threshold(word);
  if (limit === 0) return [];
  let best = Infinity;
  let out: string[] = [];
  for (const entry of vocabulary) {
    if (Math.abs(entry.length - word.length) > limit) continue;
    const score = distance(word, entry);
    if (score === 0 || score > limit) continue;
    if (score < best) {
      best = score;
      out = [entry];
    } else if (score === best && !out.includes(entry)) {
      out.push(entry);
    }
  }
  return out;
}
