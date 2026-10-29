import { REDUCED_MOTION_QUERY } from "../../motion/preference";
import { LIGHT_SCHEME_QUERY, mediaMatches, subscribeMedia } from "./media";
import { resolveTheme, THEME_COLORS, type ResolvedTheme } from "./uiPrefs";
import { useUiStore } from "./uiStore";

function setThemeColor(theme: ResolvedTheme) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLORS[theme]);
    meta.removeAttribute("media");
  }
}

/** Paints the resolved theme on <html> (data-theme, color-scheme, browser chrome colour). */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  setThemeColor(theme);
}

function applyDocument() {
  const state = useUiStore.getState();
  applyTheme(resolveTheme(state.theme, mediaMatches(LIGHT_SCHEME_QUERY)));
  const root = document.documentElement;
  if (state.motion === "off") root.setAttribute("data-motion", "off");
  else root.removeAttribute("data-motion");
  root.setAttribute("data-mode", state.mode);
}

let installed = false;

/**
 * Keeps <html> in step with the ui store and the system preferences:
 * data-theme, data-motion (the CSS reduced-motion switch), data-mode and
 * data-hidden (pauses `.el-loop` animations in background tabs). Installed
 * once by main.tsx before the first render.
 */
export function installUiDocumentSync(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  applyDocument();
  useUiStore.subscribe(applyDocument);
  subscribeMedia(LIGHT_SCHEME_QUERY, applyDocument);
  subscribeMedia(REDUCED_MOTION_QUERY, applyDocument);
  const syncHidden = () => document.documentElement.toggleAttribute("data-hidden", document.visibilityState === "hidden");
  syncHidden();
  document.addEventListener("visibilitychange", syncHidden);
}
