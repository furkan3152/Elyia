import { useEffect, useRef } from "react";

import { isEditableTarget } from "../../app/keyboard/sequence";
import { presetAmount } from "../../features/trading/ticketMath";
import { SIZE_PRESETS, useTradeStore } from "../../features/trading/tradeStore";
import { maxBaseFor, ticketLeverage } from "./sizing";
import type { Terminal } from "./terminalContext";
import { useTerminalUi } from "./terminalUi";

/**
 * Terminal keys: B / S side, L / M / T limit, market, TWAP, 1-5 size
 * presets, X closes the selected position (it opens the close dialog; the
 * person still confirms), F opens "descend all" (hold to confirm), Esc clears the ticket, "/" opens the market
 * picker. They never fire while typing or while a dialog is open, never
 * with a modifier, and never sign anything by themselves.
 */
export function useTradeHotkeys(terminal: Terminal): void {
  const ref = useRef(terminal);
  useEffect(() => {
    ref.current = terminal;
  });

  useEffect(() => {
    let lastG = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as (Element & { isContentEditable?: boolean; type?: string }) | null;
      const modalOpen = document.querySelector('[aria-modal="true"]') !== null;
      if (isEditableTarget(target)) {
        if (event.key === "Escape" && !modalOpen) (target as HTMLElement | null)?.blur?.();
        return;
      }
      if (modalOpen) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      // "g" then a letter is global navigation (g t = Trade): leave the second key alone.
      if (key === "g") {
        lastG = performance.now();
        return;
      }
      if (performance.now() - lastG < 900) return;
      const { market, feeds, mid, readOnly } = ref.current;
      const store = useTradeStore.getState();
      const ui = useTerminalUi.getState();
      const handled = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      switch (key) {
        case "/":
          handled();
          ui.set({ pickerOpen: true });
          return;
        case "b":
          handled();
          store.patch({ side: "buy" });
          return;
        case "s":
          handled();
          store.patch({ side: "sell" });
          return;
        case "l":
          handled();
          store.patch({ kind: "limit" });
          return;
        case "m":
          handled();
          store.patch({ kind: "market" });
          return;
        case "t":
          handled();
          store.patch({ kind: "twap" });
          return;
        case "f": {
          // Descend all: opens the flatten sheet; it still needs a press-and-hold to sign.
          if (readOnly || ((feeds.positions?.length ?? 0) === 0 && (feeds.openOrders?.length ?? 0) === 0)) return;
          handled();
          ui.set({ flattenOpen: true });
          return;
        }
        case "x": {
          if (readOnly) return;
          const positions = feeds.positions ?? [];
          const coin = store.selectedPosition ?? (positions.find((row) => row.coin === market?.coin) ?? (positions.length === 1 ? positions[0] : undefined))?.coin ?? null;
          if (!coin) return;
          handled();
          ui.set({ closeCoin: coin });
          return;
        }
        case "Escape":
          store.resetTicket();
          store.selectPosition(null);
          return;
        default:
          break;
      }
      const digit = Number(key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= SIZE_PRESETS.length && market) {
        const percent = SIZE_PRESETS[digit - 1] as number;
        const { leverage } = ticketLeverage(market, feeds, store.leverage[market.coin], store.marginMode[market.coin]);
        const px = store.kind === "limit" && Number(store.price) > 0 ? Number(store.price) : mid;
        const maxBase = maxBaseFor({ market, feeds, side: store.side, px, leverage });
        if (maxBase === null) return;
        const amount = presetAmount({ percent, maxBase, unit: store.sizeUnit, px, szDecimals: market.szDecimals });
        if (amount === null) return;
        handled();
        store.patch({ amount });
      }
    };
    // Capture phase: runs before the global layer, so "/" opens markets here instead of the Oracle.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
