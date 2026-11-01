import { prefersReducedMotion } from "../../../motion/useReducedMotion";

/** Scrolls a portal section into view, focuses it and puts its id in the URL (no navigation). */
export function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, "", `#${id}`);
}

