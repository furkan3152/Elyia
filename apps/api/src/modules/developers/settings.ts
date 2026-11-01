/**
 * Per-developer settings: the integrator fee (shown to end users on every
 * route card that carries it) and the embeddable widget (allowed origins,
 * theme, networks). One document per developer in `developer_settings`.
 */
import { MAX_INTEGRATOR_FEE_BPS, type IntegratorFeeConfig, type WidgetConfig, type WidgetTheme } from "@elyia/core/api/developers";
import type { NetworkKey } from "@elyia/core";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import { docs, iso, PLATFORM_COLLECTIONS } from "../ops/docs.js";

export interface DeveloperSettings {
  readonly fee: { readonly feeBps: number; readonly recipient: string | null; readonly updatedAt: number | null };
  readonly widget: { readonly allowedOrigins: readonly string[]; readonly theme: WidgetTheme; readonly networks: readonly NetworkKey[]; readonly updatedAt: number | null };
}

export const DEFAULT_THEME: WidgetTheme = Object.freeze({ mode: "auto", accent: null, radius: "pixel", locale: "auto" });

function defaults(ctx: AppContext): DeveloperSettings {
  const networks = (Object.keys(ctx.config.networks) as NetworkKey[]).filter((key) => ctx.config.networks[key].environment === ctx.config.mode);
  return { fee: { feeBps: 0, recipient: null, updatedAt: null }, widget: { allowedOrigins: [], theme: DEFAULT_THEME, networks, updatedAt: null } };
}

export async function settingsOf(ctx: AppContext, developerId: string): Promise<DeveloperSettings> {
  return (await docs<DeveloperSettings>(ctx, PLATFORM_COLLECTIONS.developerSettings).get(developerId))?.value ?? defaults(ctx);
}

async function save(ctx: AppContext, developerId: string, settings: DeveloperSettings): Promise<void> {
  await docs<DeveloperSettings>(ctx, PLATFORM_COLLECTIONS.developerSettings).put(developerId, settings);
}

export function disclosure(feeBps: number): { readonly en: string; readonly tr: string } {
  const pct = (feeBps / 100).toFixed(2);
  return feeBps === 0
    ? { en: "No integrator fee.", tr: "Entegratör ücreti yok." }
    : { en: `This app adds a ${pct}% integrator fee, paid on chain through ElyiaRouter.`, tr: `Bu uygulama ElyiaRouter üzerinden zincir üstünde ödenen %${pct} entegratör ücreti ekler.` };
}

export function feeView(settings: DeveloperSettings): IntegratorFeeConfig {
  return { feeBps: settings.fee.feeBps, recipient: settings.fee.recipient, updatedAt: iso(settings.fee.updatedAt), disclosure: disclosure(settings.fee.feeBps) };
}

export function widgetView(developerId: string, settings: DeveloperSettings): WidgetConfig {
  return {
    developerId,
    allowedOrigins: settings.widget.allowedOrigins,
    theme: settings.widget.theme,
    networks: settings.widget.networks,
    fee: feeView(settings),
    updatedAt: iso(settings.widget.updatedAt),
  };
}

export async function setFee(ctx: AppContext, developerId: string, input: { readonly feeBps: number; readonly recipient: string | null }): Promise<DeveloperSettings> {
  if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > MAX_INTEGRATOR_FEE_BPS) {
    throw new ElyiaHttpError("FEE_OUT_OF_RANGE", 400, `The integrator fee is 0-${MAX_INTEGRATOR_FEE_BPS} basis points.`, { max: MAX_INTEGRATOR_FEE_BPS });
  }
  if (input.feeBps > 0 && !input.recipient) throw new ElyiaHttpError("FEE_RECIPIENT_REQUIRED", 400, "A fee above 0 needs a recipient address.");
  const current = await settingsOf(ctx, developerId);
  const next: DeveloperSettings = { ...current, fee: { feeBps: input.feeBps, recipient: input.recipient?.toLowerCase() ?? null, updatedAt: ctx.clock.now() } };
  await save(ctx, developerId, next);
  return next;
}

export async function setWidget(
  ctx: AppContext,
  developerId: string,
  input: { readonly allowedOrigins?: readonly string[]; readonly theme?: Partial<WidgetTheme>; readonly networks?: readonly NetworkKey[] },
): Promise<DeveloperSettings> {
  const current = await settingsOf(ctx, developerId);
  for (const network of input.networks ?? []) {
    if (ctx.config.networks[network].environment !== ctx.config.mode) throw new ElyiaHttpError("NETWORK_NOT_SUPPORTED", 400, `${network} is not a ${ctx.config.mode} network.`);
  }
  const next: DeveloperSettings = {
    ...current,
    widget: {
      allowedOrigins: input.allowedOrigins ? [...new Set(input.allowedOrigins)] : current.widget.allowedOrigins,
      theme: { ...current.widget.theme, ...(input.theme ?? {}) },
      networks: input.networks ? [...new Set(input.networks)] : current.widget.networks,
      updatedAt: ctx.clock.now(),
    },
  };
  await save(ctx, developerId, next);
  return next;
}
