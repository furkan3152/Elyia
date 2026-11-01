import { useNow } from "../../hooks/useNow";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { useWalletBridge } from "./bridgeStore";
import { primaryRole, sameAddress, shortAddress, timeLeftLabel } from "./sessionModel";
import { signOut, useSession } from "./sessionApi";

const PHASE_TEXT = { nonce: "Asking the API for a nonce…", wallet: "Check your wallet: sign the message.", verify: "Verifying the signature…" } as const;

export interface SessionBarProps {
  /** What signing in unlocks, in a few words ("manage your API keys"). */
  readonly purpose: string;
  /** "bar": a compact row for a top bar; "panel": a centred block with the explanation. */
  readonly variant?: "bar" | "panel";
  readonly className?: string;
}

function RolePill({ role }: { readonly role: "admin" | "developer" | "user" }) {
  return <span className={cx("px-2 py-[3px] font-tag text-[10px] uppercase leading-none", role === "admin" ? "bg-accent text-accent-ink" : role === "developer" ? "bg-signal text-signal-ink" : "bg-paper-3 text-ink")}>{role}</span>;
}

/**
 * The wallet session control, wallet-free: the signed-in pill (SIWE · address
 * · time left · role · sign out), or Connect, or Sign in. The wallet work runs
 * in the bridge (SessionBridge), mounted lazily on site pages. Signing in signs
 * a message, never a transaction.
 */
export function SessionBar({ purpose, variant = "bar", className }: SessionBarProps) {
  const { session, status, validated } = useSession();
  const bridge = useWalletBridge();
  const panel = variant === "panel";
  const now = useNow(30_000);
  const mismatch = Boolean(session && bridge.address && !sameAddress(session.address, bridge.address));
  const busy = bridge.phase === "nonce" || bridge.phase === "wallet" || bridge.phase === "verify";
  const loading = bridge.wanted && !bridge.ready;

  let control: React.ReactNode;
  if (session && status !== "expired" && !mismatch) {
    const role = primaryRole(session);
    control = (
      <div className={cx("flex flex-wrap items-center gap-2", panel ? "justify-center" : "justify-end")}>
        <span className="font-tag text-[10px] uppercase tracking-[0.04em] text-ink-2">
          SIWE · {shortAddress(session.address)} · {validated ? timeLeftLabel(session, now) : "checking…"}
        </span>
        {role ? <RolePill role={role} /> : null}
        <Button variant="ink" size="xs" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    );
  } else if (!bridge.isConnected) {
    control = (
      <Button variant={panel ? "primary" : "ink"} size="sm" loading={loading} onClick={bridge.request} className={panel ? "portal-pulse" : undefined}>
        Connect wallet
      </Button>
    );
  } else {
    control = (
      <div className={cx("flex flex-wrap items-center gap-2", panel ? "justify-center" : "justify-end")}>
        {mismatch && session ? <span className="font-tag text-[10px] uppercase text-warn-ink">Session {shortAddress(session.address)} · wallet {shortAddress(bridge.address)}</span> : null}
        <Button variant="primary" size="sm" loading={busy} disabled={!bridge.signIn} onClick={() => void bridge.signIn?.()} className={panel && !busy ? "portal-pulse" : undefined}>
          {mismatch ? "Sign in as this wallet" : `Sign in · ${shortAddress(bridge.address)}`}
        </Button>
      </div>
    );
  }

  const phaseText = busy ? PHASE_TEXT[bridge.phase as keyof typeof PHASE_TEXT] : null;
  const message = bridge.phase === "error" && bridge.error ? bridge.error : (phaseText ?? (session && !mismatch ? null : `Sign a message to ${purpose}. It proves you hold the address; it moves no funds and costs no gas.`));

  return (
    <div className={cx("flex flex-col gap-2", panel ? "items-center text-center" : "items-end text-right", className)}>
      {control}
      <p role="status" aria-live="polite" className={cx("max-w-[420px] text-[11.5px] leading-snug", bridge.phase === "error" ? "text-down" : "text-ink-3", !panel && bridge.phase !== "error" && !phaseText && "sr-only")}>
        {message}
      </p>
    </div>
  );
}
