/**
 * Portal sub-views (pure): the developer portal is split into views
 * (Overview, Playground, Quickstart and MCP, Keys and usage, Ship it,
 * Reference) chosen by the URL hash. A deep link names a section
 * (`/developers#webhooks`): the view that holds it opens and scrolls to it.
 * Unknown or empty hashes open the first view.
 */
export interface ViewItem {
  /** Section id (the hash). */
  readonly id: string;
  /** The view that holds it. */
  readonly view: string;
}

/** The section id a hash names ("#keys" -> "keys"), or null. */
export function hashTarget(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/u, "")).trim();
  return /^[a-z][a-z0-9-]{0,40}$/u.test(id) ? id : null;
}

/** The view for a hash: the view holding the named section, else the first view. */
export function viewForHash(hash: string, items: readonly ViewItem[], views: readonly string[]): { readonly view: string; readonly section: string | null } {
  const target = hashTarget(hash);
  const fallback = views[0] ?? "";
  if (!target) return { view: fallback, section: null };
  if (views.includes(target)) return { view: target, section: null };
  const item = items.find((entry) => entry.id === target);
  return item && views.includes(item.view) ? { view: item.view, section: target } : { view: fallback, section: null };
}

/** The views before and after `view` (the footer's previous / next links). */
export function neighbours(view: string, views: readonly string[]): { readonly previous: string | null; readonly next: string | null } {
  const index = views.indexOf(view);
  if (index < 0) return { previous: null, next: null };
  return { previous: views[index - 1] ?? null, next: views[index + 1] ?? null };
}
