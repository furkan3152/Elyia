import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useCallback, useEffect, useRef, useState } from "react";

import { Link } from "../../../app/routes/Link";
import { routeHref } from "../../../app/routes/routeTable";
import { useUiStore } from "../../../app/state/uiStore";
import { drawWalker, paletteOf } from "../../../features/ely/draw";
import { Glyph } from "../../../features/ely/ui";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { Popover } from "../../../ui/Popover";
import { cx, FOCUS_RING } from "../../../ui/cx";

const TOKENS = ["HYPE", "USDC", "kHYPE", "ETH", "SOL", "BTC"] as const;

export interface ComposerProps {
  readonly placeholder: string;
  /** A turn is streaming: Ely walks the top edge and the send button stops it. */
  readonly thinking: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop?: () => void;
  /** Connected or watched address (short), null for the labelled sample. */
  readonly account: string | null;
  readonly sample: boolean;
  readonly phone?: boolean;
  readonly autoFocus?: boolean;
  /** Half-width column (conversation beside the artifact): shorter chips. */
  readonly compact?: boolean;
}

function Walker() {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly seconds: number; readonly still: boolean }) => drawWalker(ctx, info.w, info.still ? 1 : info.seconds, paletteOf(ctx.canvas)), []);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0" style={{ top: -40 }}>
      <PixelCanvas width={200} height={21} pixelSize={2} draw={draw} animate fps={12} endTime={1} decorative />
    </div>
  );
}

/**
 * The composer (`.fr.lg`): a textarea, chips for an address or token, the
 * network and the account, the Propose | Autopilot segment and the send
 * button. Enter sends, Shift+Enter breaks the line. Autopilot never signs on
 * its own: it only runs inside caps the person signs once (Portfolio).
 */
export function Composer({ placeholder, thinking, onSend, onStop, account, sample, phone = false, autoFocus = false, compact = false }: ComposerProps) {
  const tight = phone || compact;
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const mode = useUiStore((state) => state.mode);
  const network = mode === "mainnet" ? "Elysium mainnet" : "Elysium testnet";

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const insert = (word: string) => {
    const box = ref.current;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const spaced = `${before && !before.endsWith(" ") ? " " : ""}${word} `;
    const next = `${before}${spaced}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      box?.focus();
      const at = before.length + spaced.length;
      box?.setSelectionRange(at, at);
    });
  };

  const send = () => {
    const value = text.trim();
    if (!value || thinking) return;
    onSend(value);
    setText("");
  };

  return (
    <div className="w-full">
      <form
        className="composer fr lg"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {thinking ? <Walker /> : null}
        <label htmlFor="ely-composer" className="sr-only">
          Message Ely
        </label>
        <textarea
          id="ely-composer"
          ref={ref}
          rows={2}
          value={text}
          maxLength={2_000}
          placeholder={placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          style={{ height: phone ? 40 : 48 }}
        />
        <div className="crow">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Popover
            label="Add an address or a token"
            align="start"
            className="!top-auto bottom-full !mb-3 !mt-0"
            trigger={(props) => (
              <button type="button" {...props} className={cx("chip", FOCUS_RING)} aria-label="Add an address or a token">
                ＋{tight ? "" : " Address / token"}
              </button>
            )}
          >
            {(close) => (
              <div className="ely2 flex w-[240px] flex-col gap-2">
                <span className="t-tag t-mute">Add to the sentence</span>
                {account && !sample ? (
                  <button
                    type="button"
                    className={cx("chip justify-start", FOCUS_RING)}
                    onClick={() => {
                      insert(account);
                      close();
                    }}
                  >
                    <span className="k">acct</span>
                    <span className="num truncate">{`${account.slice(0, 6)}…${account.slice(-4)}`}</span>
                  </button>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      className={cx("chip tiny", FOCUS_RING)}
                      onClick={() => {
                        insert(token);
                        close();
                      }}
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Popover>
          <span className="chip" title="Network mode (switch it in Settings)">
            <span className="dotc acc" />
            {tight ? "Elysium" : network}
          </span>
          {phone ? null : sample ? (
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => (
                <button type="button" className={cx("chip", FOCUS_RING)} onClick={openConnectModal} disabled={!mounted}>
                  <span className="k">acct</span>sample
                </button>
              )}
            </ConnectButton.Custom>
          ) : (
            <span className="chip">
              <span className="k">acct</span>
              <span className="num">{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "—"}</span>
            </span>
          )}
          </div>
          <ModeSegment phone={phone} />
          {thinking && onStop ? (
            <button type="button" onClick={onStop} className={cx("b dn", FOCUS_RING)} style={{ width: 40, height: 40, padding: 0 }} aria-label="Stop Ely">
              ■
            </button>
          ) : (
            <button type="submit" className={cx("b acc", FOCUS_RING)} style={{ width: 40, height: 40, padding: 0 }} aria-label="Send to Ely" disabled={text.trim().length === 0}>
              <Glyph name="send" scale={2} />
            </button>
          )}
        </div>
      </form>
      <p className="cnote">{phone ? "Ely drafts · you sign" : "Ely drafts · your wallet signs · Autopilot stays inside the caps you set"}</p>
    </div>
  );
}

/** Propose (default) | Autopilot: Autopilot explains its caps and points to where they are signed; it never switches on silently. */
function ModeSegment({ phone }: { readonly phone: boolean }) {
  return (
    <Popover
      label="Autopilot"
      align="end"
      className="!top-auto bottom-full !mb-3 !mt-0"
      trigger={(props) => (
        <div className="seg" role="group" aria-label="Mode">
          <button type="button" aria-pressed="true" className={FOCUS_RING}>
            Propose
          </button>
          {phone ? null : (
            <button type="button" aria-pressed="false" {...props} className={FOCUS_RING}>
              Autopilot
            </button>
          )}
        </div>
      )}
    >
      {(close) => (
        <div className="ely2 flex w-[300px] flex-col gap-2 text-left text-[12.5px] leading-snug">
          <span className="t-tag t-acc">Autopilot · bounded</span>
          <p>Autopilot acts only inside a policy you sign once in your wallet: an allowlist, a per-order and a daily cap, reduce-only orders and an expiry. Revoke it in one tap. Ely can never withdraw to anyone but you.</p>
          <p className="t-mute">Here, Ely proposes and you sign every route.</p>
          <Link to={`${routeHref("portfolio")}#automations`} onClick={close} className={cx("b sm acc self-start", FOCUS_RING)}>
            Set caps in Portfolio ▸
          </Link>
        </div>
      )}
    </Popover>
  );
}
