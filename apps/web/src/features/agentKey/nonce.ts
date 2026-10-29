/**
 * Nonces for the in-browser agent key: millisecond timestamps, strictly
 * increasing per signer, persisted so a reload (or a second tab) never
 * reuses one. HyperCore keeps each signer's 100 highest nonces and accepts a
 * new one only when it is unused, above the smallest of those, and within
 * (now - 2 days, now + 1 day).
 */

export interface NonceStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function nonceStorageKey(signer: string): string {
  return `elyia.nonce.${signer.toLowerCase()}`;
}

/** A persisted value further ahead than this is treated as a broken clock and ignored. */
const FUTURE_LIMIT_MS = 12 * 60 * 60 * 1000;

export class NonceManager {
  private last: number;

  constructor(
    private readonly signer: string,
    private readonly storage: NonceStorage,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.last = this.read();
  }

  private read(): number {
    const stored = (() => {
      try {
        const raw = this.storage.get(nonceStorageKey(this.signer));
        const parsed = raw === null ? 0 : Number(raw);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
      } catch {
        return 0;
      }
    })();
    return stored > this.now() + FUTURE_LIMIT_MS ? 0 : stored;
  }

  /** The next nonce: now in ms, or one more than the last one handed out (here or in another tab). */
  next(): number {
    const persisted = this.read();
    const floor = Math.max(this.last, persisted);
    const nonce = Math.max(Math.floor(this.now()), floor + 1);
    this.last = nonce;
    try {
      this.storage.set(nonceStorageKey(this.signer), String(nonce));
    } catch {
      // In-memory monotonicity still holds for this tab.
    }
    return nonce;
  }

  /** The last nonce handed out (0 when none). */
  peek(): number {
    return Math.max(this.last, this.read());
  }
}

/** Storage backed by the guarded localStorage helpers, or an in-memory map in tests. */
export function memoryNonceStorage(): NonceStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: (key) => values.get(key) ?? null, set: (key, value) => void values.set(key, value) };
}
