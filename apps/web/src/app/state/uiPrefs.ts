/**
 * Pure rules for the interface preferences (theme, motion, network mode).
 * No DOM and no storage access at import: node tests load this file, and
 * index.html's pre-paint script mirrors `UI_STORAGE_KEY` and the theme rule.
 */
import { NETWORKS, type NetworkEnvironment } from "@elyia/core/networks";

/** One localStorage key for the persisted ui store (zustand `persist` JSON). */
export const UI_STORAGE_KEY = "elyia-ui";
export const UI_STORAGE_VERSION = 1;

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";
export type MotionSetting = "on" | "off";
export type NetworkMode = NetworkEnvironment;

/** Browser chrome colour per theme: the page background (bg-0). */
export const THEME_COLORS: Readonly<Record<ResolvedTheme, string>> = Object.freeze({ dark: "#07060D", light: "#FBF8F2" });

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "dark" || value === "light";
}

export function isMotionSetting(value: unknown): value is MotionSetting {
  return value === "on" || value === "off";
}

export function isNetworkMode(value: unknown): value is NetworkMode {
  return value === "testnet" || value === "mainnet";
}

/** The theme to paint: an explicit choice wins, else the system preference (dark when unknown). */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean | null): ResolvedTheme {
  if (preference !== "system") return preference;
  return systemPrefersLight === true ? "light" : "dark";
}

/** The next explicit theme when the toggle is pressed (system resolves first). */
export function nextTheme(preference: ThemePreference, systemPrefersLight: boolean | null): ResolvedTheme {
  return resolveTheme(preference, systemPrefersLight) === "dark" ? "light" : "dark";
}

export interface ModeAvailability {
  readonly available: boolean;
  /** Plain-words reason shown next to a disabled switch. */
  readonly reason: string | null;
}

/**
 * Mainnet mode opens only when every Elysium mainnet piece Elyia needs is
 * published: the network is live and has a public RPC. Until then the switch
 * stays disabled and says why; testnet and mainnet capital never mix.
 */
export function modeAvailability(mode: NetworkMode): ModeAvailability {
  if (mode === "testnet") return { available: true, reason: null };
  const elysium = NETWORKS["elysium-mainnet"];
  if (elysium.status !== "live") {
    return { available: false, reason: "Elysium mainnet launches on November 9, 2026. Elyia opens mainnet once its public RPC is published." };
  }
  if (elysium.vm === "evm" && elysium.rpcUrls.length === 0) {
    return { available: false, reason: "Elysium mainnet has no public RPC yet, so Elyia stays on testnet." };
  }
  return { available: true, reason: null };
}

/** The mode to use: a stored mainnet choice falls back to testnet while mainnet is unavailable. */
export function effectiveMode(stored: unknown): NetworkMode {
  if (stored === "mainnet" && modeAvailability("mainnet").available) return "mainnet";
  return "testnet";
}

export interface PersistedUiPrefs {
  readonly theme: ThemePreference;
  readonly motion: MotionSetting;
  readonly mode: NetworkMode;
  readonly railCollapsed: boolean;
}

export const DEFAULT_UI_PREFS: PersistedUiPrefs = Object.freeze({
  theme: "system",
  motion: "on",
  mode: "testnet",
  railCollapsed: false,
});

/** Strict parse of the persisted state: unknown or malformed fields fall back to defaults one by one. */
export function sanitizeUiPrefs(value: unknown): PersistedUiPrefs {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    theme: isThemePreference(record.theme) ? record.theme : DEFAULT_UI_PREFS.theme,
    motion: isMotionSetting(record.motion) ? record.motion : DEFAULT_UI_PREFS.motion,
    mode: effectiveMode(record.mode),
    railCollapsed: typeof record.railCollapsed === "boolean" ? record.railCollapsed : DEFAULT_UI_PREFS.railCollapsed,
  };
}
