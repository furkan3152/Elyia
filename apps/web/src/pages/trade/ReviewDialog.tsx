import type { L1Action } from "@elyia/core/hypercore/actions";
import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { evaluatePlan, type TradePlan } from "../../features/trading/executor";
import { formatPx, type TradeMarket } from "../../lib/hypercore/marketCatalog";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { GuardStrip } from "./GuardStrip";
import { useTerminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

function describe(action: L1Action, plan: TradePlan, byAsset: (asset: number) => TradeMarket | null): string[] {
  switch (action.type) {
    case "updateLeverage": {
      const market = byAsset(action.asset);
      return [`Set ${market?.base ?? "the market"} leverage to ${action.leverage}× ${action.isCross ? "cross" : "isolated"}`];
    }
    case "order":
      return action.orders.map((order, index) => {
        const market = byAsset(order.a);
        const leg = plan.legs?.[index];
        const side = order.b ? "buy" : "sell";
        if ("trigger" in order.t) {
          const kind = order.t.trigger.tpsl === "tp" ? "Take profit" : "Stop loss";
          return `${kind}: ${side} ${order.s} when the mark crosses ${formatPx(order.t.trigger.triggerPx, market)} (${order.t.trigger.isMarket ? "at market" : `limit ${formatPx(order.p, market)}`}, reduce-only)`;
        }
        const tif = order.t.limit.tif === "Ioc" ? (leg?.role === "close" ? "IOC close" : "IOC (market)") : order.t.limit.tif === "Alo" ? "post-only" : "GTC";
        return `${side === "buy" ? "Buy" : "Sell"} ${order.s} ${market?.base ?? ""} ${order.t.limit.tif === "Ioc" ? "up to" : "at"} ${formatPx(order.p, market)} · ${tif}${order.r ? " · reduce-only" : ""}`;
      });
    case "twapOrder": {
      const market = byAsset(action.twap.a);
      return [`TWAP ${action.twap.b ? "buy" : "sell"} ${action.twap.s} ${market?.base ?? ""} over ${action.twap.m} min${action.twap.t ? ", randomized" : ""}${action.twap.r ? ", reduce-only" : ""}`];
    }
    case "cancel":
      return [`Cancel ${action.cancels.length} order${action.cancels.length === 1 ? "" : "s"}`];
    case "twapCancel":
      return ["Cancel the TWAP"];
    default:
      return [action.type];
  }
}

/** The review step before the key signs: what exactly will be signed, and the Rule Book's verdict. */
export function ReviewDialog() {
  const review = useTerminalUi((state) => state.review);
  const close = () => useTerminalUi.getState().set({ review: null });
  return (
    <Dialog open={review !== null} onClose={close} title={review?.plan.label ?? "Review"} description={review?.reason === "confirm" ? (review.message ?? "Your Rule Book asks you to confirm this.") : "Check it, then the trade-only key signs it in this browser."} size="md">
      {review ? <ReviewBody plan={review.plan} onClose={close} /> : null}
    </Dialog>
  );
}

function ReviewBody({ plan, onClose }: { readonly plan: TradePlan; readonly onClose: () => void }) {
  const { guardBase, rules, now, run, markets } = useTerminal();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byAsset = useMemo(() => {
    const map = new Map(markets.map((market) => [market.asset, market]));
    return (asset: number) => map.get(asset) ?? null;
  }, [markets]);
  const verdict = useMemo(() => (guardBase ? evaluatePlan(rules.book, guardBase, plan, now) : null), [guardBase, rules.book, plan, now]);
  const lines = plan.actions.flatMap((action) => describe(action, plan, byAsset));
  const isSell = plan.actions.some((action) => action.type === "order" && action.orders[0] && !action.orders[0].b);
  const send = async () => {
    setSending(true);
    setError(null);
    const result = await run(plan, { confirmed: true });
    setSending(false);
    if (result.ok) onClose();
    else if (result.kind !== "confirm") setError(result.message);
  };
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col gap-2">
        {lines.map((line, index) => (
          <li key={`${index}-${line}`} className="flex gap-2.5 border-2 border-rule bg-paper/60 px-3 py-2 font-mono text-[13px] text-ink">
            <span className="tnum text-ink-3">{index + 1}</span>
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ol>
      <GuardStrip verdict={verdict} />
      <p className="flex items-center gap-2 text-xs text-ink-3">
        <ShieldCheck className="h-4 w-4 text-up" aria-hidden="true" />
        Signed in this browser by elyia-web: a trade-only key that cannot withdraw. {plan.actions.length > 1 ? `${plan.actions.length} signatures, in this order.` : "One signature."}
      </p>
      {error ? (
        <p role="alert" className="border-l-[3px] border-down bg-paper/60 px-3 py-2 text-sm text-down">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button variant={isSell ? "short" : "long"} loading={sending} disabled={verdict?.decision === "deny"} onClick={() => void send()} autoFocus>
          {verdict?.decision === "confirm" ? "Confirm & sign" : "Sign & send"}
        </Button>
      </div>
    </div>
  );
}
