/**
 * Evaluates every rule against live readings in this tab: HyperCore mids,
 * hourly funding from the market catalogue, the followed account's ropes
 * and fills. A rule that fires is stamped, lands in the in-app feed and on
 * the radio (toast). Standing orders only draft their action: nothing here
 * signs, and nothing signs on a timer.
 */
import type { NetworkEnvironment } from "@elyia/core/networks";
import type { UserFill } from "@elyia/core/hypercore/info";
import { useEffect, useMemo } from "react";

import { useMarketCatalog } from "../../../features/trading/useMarketData";
import { useMids } from "../../../features/trading/useTopoData";
import { toast } from "../../../ui/toast";
import { useAlertStore } from "./alertStore";
import { afterFire, evaluateRule, shouldFire, type RuleReadings, type RuleStatus } from "./rules";

export interface RuleWatch {
  readonly readings: RuleReadings;
  readonly statuses: ReadonlyMap<string, RuleStatus>;
  /** Mids and funding have arrived. */
  readonly ready: boolean;
}

export function useRuleWatch(input: { readonly mode: NetworkEnvironment; readonly ropes: readonly { readonly coin: string; readonly distance: number | null }[]; readonly fills: readonly UserFill[] | null; readonly now: number; readonly live: boolean }): RuleWatch {
  const { mode, ropes, fills, now, live } = input;
  const mids = useMids(mode);
  const catalog = useMarketCatalog(mode);
  const rules = useAlertStore((state) => state.rules);

  const readings = useMemo<RuleReadings>(() => {
    const midMap: Record<string, number> = {};
    for (const [coin, value] of Object.entries(mids ?? {})) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) midMap[coin] = parsed;
    }
    const funding: Record<string, number> = {};
    for (const market of catalog.markets) {
      if (market.kind !== "perp") continue;
      const hourly = market.ctx?.funding;
      if (typeof hourly === "number" && Number.isFinite(hourly)) funding[market.coin] = hourly;
      if (midMap[market.coin] === undefined && market.ctx?.markPx) midMap[market.coin] = market.ctx.markPx;
    }
    return {
      mids: midMap,
      funding,
      ropes,
      fills: (fills ?? []).map((fill) => ({ coin: fill.coin, time: fill.time, side: fill.side === "B" ? ("buy" as const) : ("sell" as const), px: fill.px, sz: fill.sz })),
      bridges: [],
      now,
    };
  }, [mids, catalog.markets, ropes, fills, now]);

  const statuses = useMemo(() => new Map(rules.map((rule) => [rule.id, evaluateRule(rule, readings)] as const)), [rules, readings]);
  const ready = Object.keys(readings.mids).length > 0;

  // Fire what is met. `live` is false while showing the sample range: sample ropes never fire.
  useEffect(() => {
    if (!ready) return;
    const store = useAlertStore.getState();
    for (const rule of store.rules) {
      const status = statuses.get(rule.id);
      if (!status || !status.event) continue;
      if (!live && (rule.kind === "rope" || rule.kind === "fill")) continue;
      if (!shouldFire(rule, status, readings.now)) continue;
      store.updateRule(rule.id, afterFire(rule, readings.now));
      const coin = status.subject ?? rule.coin;
      store.pushFeed({ id: `${rule.id}-${readings.now}`, at: readings.now, ruleId: rule.id, kind: rule.kind, message: status.event, ...(rule.action ? { action: rule.action } : {}), ...(coin ? { coin } : {}), telegram: false, read: false });
      toast({
        title: rule.action ? "Standing order: your turn" : status.event,
        description: rule.action ? `${status.event}. The Guide drafted “${rule.action}”; open the Guide to review and sign.` : "Alert fired · in-app feed",
        tone: rule.kind === "rope" ? "warning" : "info",
        from: rule.action ? "GUIDE" : "ALERT",
        id: `alert-${rule.id}`,
      });
    }
  }, [statuses, ready, live, readings.now]);

  return { readings, statuses, ready };
}
