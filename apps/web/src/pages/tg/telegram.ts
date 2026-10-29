/**
 * Telegram Mini App bridge, read defensively (no SDK dependency): Telegram
 * injects `window.Telegram.WebApp` when it opens the page. Outside Telegram
 * every field is absent and the page behaves like a plain web page.
 */

export interface TelegramMainButton {
  setText?(text: string): unknown;
  show?(): unknown;
  hide?(): unknown;
  onClick?(callback: () => void): unknown;
  offClick?(callback: () => void): unknown;
  setParams?(params: Record<string, unknown>): unknown;
}

export interface TelegramWebAppLike {
  readonly colorScheme?: unknown;
  readonly themeParams?: unknown;
  readonly initDataUnsafe?: unknown;
  readonly platform?: unknown;
  readonly MainButton?: TelegramMainButton;
  ready?(): unknown;
  expand?(): unknown;
  setHeaderColor?(color: string): unknown;
  setBackgroundColor?(color: string): unknown;
  openLink?(url: string): unknown;
  HapticFeedback?: { impactOccurred?(style: string): unknown };
}

export interface TelegramContext {
  /** Opened inside Telegram (the WebApp object exists and reports a platform). */
  readonly inside: boolean;
  /** The chat's colour scheme, when Telegram says. */
  readonly scheme: "day" | "night" | null;
  /** A watched address passed as `startapp=as_0x…`. */
  readonly startAddress: string | null;
  readonly firstName: string | null;
  readonly platform: string | null;
  readonly app: TelegramWebAppLike | null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Relative luminance of a #rrggbb colour, 0..1; null when it is not one. */
export function luminance(hex: unknown): number | null {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/u.test(hex)) return null;
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Reads the Telegram context from a window-like object; never throws. */
export function readTelegram(win: unknown): TelegramContext {
  const none: TelegramContext = { inside: false, scheme: null, startAddress: null, firstName: null, platform: null, app: null };
  try {
    const app = record(record(record(win)?.Telegram)?.WebApp);
    if (!app) return none;
    const platform = typeof app.platform === "string" && app.platform !== "unknown" ? app.platform : null;
    const theme = record(app.themeParams);
    let scheme: "day" | "night" | null = app.colorScheme === "dark" ? "night" : app.colorScheme === "light" ? "day" : null;
    if (!scheme) {
      const light = luminance(theme?.bg_color);
      if (light !== null) scheme = light < 0.35 ? "night" : "day";
    }
    const init = record(app.initDataUnsafe);
    const start = typeof init?.start_param === "string" ? init.start_param : "";
    const startAddress = start.startsWith("as_") && ADDRESS.test(start.slice(3)) ? start.slice(3).toLowerCase() : null;
    const user = record(init?.user);
    const firstName = typeof user?.first_name === "string" && user.first_name.trim() ? user.first_name.trim().slice(0, 32) : null;
    return { inside: platform !== null, scheme, startAddress, firstName, platform, app: app as TelegramWebAppLike };
  } catch {
    return none;
  }
}

/** Calls a WebApp method if it exists; Telegram versions differ and old clients lack some. */
export function tryCall(action: () => unknown): void {
  try {
    action();
  } catch {
    // an old Telegram client: carry on without it
  }
}
