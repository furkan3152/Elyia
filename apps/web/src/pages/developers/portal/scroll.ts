import { prefersReducedMotion } from "../../../motion/useReducedMotion";

/** Fired by `goToSection`; a portal with sub-views switches view first, then scrolls. */
export const PORTAL_GO_EVENT = "elyia:portal-go";

/** Scrolls a portal section into view and focuses it (no navigation). */
export function revealSection(id: string, options: { readonly top?: boolean } = {}) {
  const target = document.getElementById(id);
  if (!target) return;
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  if (options.top) window.scrollTo({ top: 0, behavior });
  else target.scrollIntoView({ behavior, block: "start" });
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

/**
 * Goes to a portal section: puts its id in the URL hash (a deep link; Back
 * returns) and tells the portal, which opens the view holding it.
 */
export function scrollToSection(id: string) {
  if (window.location.hash !== `#${id}`) window.history.pushState(window.history.state, "", `#${id}`);
  window.dispatchEvent(new CustomEvent(PORTAL_GO_EVENT, { detail: id }));
}
