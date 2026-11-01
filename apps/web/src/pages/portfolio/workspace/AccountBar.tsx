import type { PortfolioHistory, PortfolioSnapshot } from "@elyia/core/api/portfolio";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState } from "react";

import { Link } from "../../../app/routes/Link";
import { routeHref } from "../../../app/routes/routeTable";
import type { RopeView } from "../../../features/trading/useTopoData";
import { cx, FOCUS_RING } from "../../../ui/cx";
import { Popover } from "../../../ui/Popover";
import { WatchField } from "../parts/WatchField";
import { pct, shortAddr, usdShort } from "../range/format";
import { dayChange } from "../range/labels";
import { EXAMPLE_ADDRESS } from "../range/sample";
import type { RangeSource } from "../range/useRange";
import { altimeterDigits } from "../v2/model";
import { allocation, riskLine } from "./model";

/** The value before the last change (React's "previous props" pattern): the digits that differ from it are the ones that roll. */
function usePrevious(value: number): number | null {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<number | null>(null);
  if (current !== value) {
    setPrevious(current);
    setCurrent(value);
  }
  return previous;
}

/** Net worth in compact altimeter digit blocks: only the digits that changed turn sun and roll, in steps. */
function Altimeter({ value }: { readonly value: number }) {
  const previous = usePrevious(value);
  const digits = altimeterDigits(value, previous);
  return (
    <div className="digits sm num" role="img" aria-label={`Net worth $${Math.round(value).toLocaleString("en-US")}`}>
      <span className="sep" aria-hidden="true">
        $
      </span>
      {digits.chars.map((char, index) =>
        char === "," ? (
          <span key={`sep-${index}`} className="sep" aria-hidden="true">
            ,
          </span>
        ) : (
          <span key={`${index}-${char}`} className={cx(digits.changed[index] && "hi")} aria-hidden="true">
            <i className={cx(digits.changed[index] && "px-digit-roll-up")}>{char}</i>
          </span>
        ),
      )}
    </div>
  );
}

export interface AccountBarProps {
  readonly snapshot: PortfolioSnapshot;
  readonly history: PortfolioHistory | null;
  readonly ropes: readonly RopeView[];
  /** The followed address, null for the labelled sample. */
  readonly followed: string | null;
  readonly own: boolean;
  readonly connected: boolean;
  readonly source: RangeSource;
  readonly testnet: boolean;
  readonly live: boolean;
  readonly automationsOn: number | null;
  readonly phone: boolean;
  readonly onAskEly: () => void;
}

/**
 * The account bar: who is on screen (switch to any address), the labels,
 * the primary actions, then the numbers a glance needs: net worth, today's
 * move, the Floor / Ridge / Summit split and the rope risk. Up and down
 * always carry ▲ / ▼, never colour alone.
 */
export function AccountBar({ snapshot, history, ropes, followed, own, connected, source, testnet, live, automationsOn, phone, onAskEly }: AccountBarProps) {
  const worth = snapshot.totals.netWorthUsd;
  const change = dayChange(history);
  const parts = allocation(snapshot);
  const risk = riskLine(ropes);
  const sample = source === "sample";
  const who = sample ? "Sample range" : own ? "Your range" : "Watching";

  return (
    <section className="ws-bar fr" aria-label="Account">
      <div className="ws-bar-top">
        <Popover
          label="Switch account"
          align="start"
          trigger={(props) => (
            <button type="button" {...props} className={cx("chip", FOCUS_RING)} aria-label={`Account: ${who}${followed ? ` ${followed}` : ""}. Switch`}>
              <span className={cx("dotc", sample ? "warn" : live ? "" : "off")} aria-hidden="true" />
              <span className="k">{phone ? (sample ? "Sample · labelled" : own ? "You" : "Watch") : who}</span>
              {followed ? <span className="num">{shortAddr(followed)}</span> : null}
              <span aria-hidden="true">▾</span>
            </button>
          )}
        >
          {(close) => (
            <div className="ely2 flex w-[340px] max-w-[86vw] flex-col gap-3">
              <span className="t-tag t-mute">Show a range · read only</span>
              <WatchField hrefFor={(address) => routeHref("portfolio", { address })} example={EXAMPLE_ADDRESS} label="Watch" />
              {connected && !own ? (
                <Link to={routeHref("portfolio")} onClick={close} className={cx("b sm self-start", FOCUS_RING)}>
                  My wallet ▸
                </Link>
              ) : null}
              {!connected ? (
                <ConnectButton.Custom>
                  {({ openConnectModal, mounted }) => (
                    <button
                      type="button"
                      className={cx("b sm self-start", FOCUS_RING)}
                      disabled={!mounted}
                      onClick={() => {
                        close();
                        openConnectModal();
                      }}
                    >
                      Connect wallet
                    </button>
                  )}
                </ConnectButton.Custom>
              ) : null}
              <p className="t-tag t-faint">Watching never signs and stores nothing.</p>
            </div>
          )}
        </Popover>
        <div className="ws-labels">
          {sample && !phone ? <span className="pill sig">Sample · labelled</span> : null}
          {!sample && testnet ? <span className="pill sig">{phone ? "Testnet" : "Testnet · reference prices"}</span> : null}
          {source === "browser" ? <span className="pill mute">read in your browser</span> : null}
          {!sample && source === "api" ? <span className="pill mute">{live ? "live" : "survey"}</span> : null}
        </div>
        <div className="ws-actions">
          <Link to={routeHref("bridge")} className={cx("b", phone ? "xs" : "sm", FOCUS_RING)}>
            {phone ? "Deposit" : "Deposit / Bridge"}
          </Link>
          <Link to={routeHref("swap")} className={cx("b", phone ? "xs" : "sm", FOCUS_RING)}>
            Swap
          </Link>
          {phone ? null : (
            <button type="button" className={cx("b sm acc", FOCUS_RING)} onClick={onAskEly} aria-keyshortcuts="/">
              Ask Ely <span className="kbd !bg-transparent !text-inherit !shadow-none">/</span>
            </button>
          )}
        </div>
      </div>
      <div className="ws-bar-main">
        <div className="ws-cell">
          <span className="ws-k">Net worth</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Altimeter value={worth} />
            <span className={cx("num ws-chg", change === null ? "t-faint" : change >= 0 ? "t-up" : "t-down")}>
              {change === null ? "no day curve" : `${change >= 0 ? "▲" : "▼"} ${usdShort(Math.abs(change))}${worth > 0 ? ` · ${pct(Math.abs(change) / Math.max(1, worth - change))}` : ""} today`}
            </span>
          </div>
        </div>
        <div className="ws-cell ws-alloc">
          <span className="ws-k">Allocation</span>
          <div className="alloc" role="img" aria-label={`Allocation: ${parts.map((part) => `${part.title} ${part.pct}%`).join(", ")}`}>
            {parts.map((part) => (part.pct > 0 ? <i key={part.layer} className={part.layer} style={{ flexGrow: part.pct }} /> : null))}
            {parts.every((part) => part.pct === 0) ? <i className="empty" style={{ flexGrow: 1 }} /> : null}
          </div>
          <div className="alloc-leg" aria-hidden="true">
            {parts.map((part) => (
              <span key={part.layer}>
                <b className={cx("sq", part.layer)} />
                {part.title} <span className="num">{part.pct}%</span>
              </span>
            ))}
          </div>
        </div>
        <div className="ws-cell ws-risk">
          <span className="ws-k">Risk</span>
          <span className={cx("num ws-risk-line", risk.tone === "dn" ? "t-down" : risk.tone === "up" ? "t-up" : "t-faint")}>{risk.text}</span>
          <span className="t-tag t-faint">
            {ropes.length} position{ropes.length === 1 ? "" : "s"}
            {automationsOn !== null ? ` · ${automationsOn} automation${automationsOn === 1 ? "" : "s"} on` : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
