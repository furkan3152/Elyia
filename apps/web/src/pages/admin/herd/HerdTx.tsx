import { short } from "../../../features/herd/herdModel";
import { Button } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { useHerdTx } from "./useHerdTx";

export interface HerdTxProps {
  /** Button label ("Prepare setPhase(WL)"). */
  readonly label: string;
  readonly functionName: string;
  /** Arguments, or a string saying why they are not ready. */
  readonly args: readonly unknown[] | string;
  readonly disabled?: string | null;
  readonly variant?: "primary" | "ink" | "danger";
  /** Typed confirmation ("PAUSE") for dangerous calls. */
  readonly confirm?: string;
  readonly className?: string;
}

/** Prepare → review (summary, warnings, eth_call) → sign in the owner's wallet → mined. */
export function HerdTx({ label, functionName, args, disabled, variant = "primary", confirm, className }: HerdTxProps) {
  const { state, prepare, sign, reset } = useHerdTx();
  const blocked = disabled ?? (typeof args === "string" ? args : null);
  const tx = "tx" in state ? state.tx : null;
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      {state.phase === "idle" || state.phase === "preparing" || (state.phase === "failed" && !tx) ? (
        <Button variant={variant === "danger" ? "danger" : variant} size="sm" disabled={Boolean(blocked)} loading={state.phase === "preparing"} onClick={() => typeof args !== "string" && void prepare(functionName, args)}>
          {label}
        </Button>
      ) : null}
      {blocked ? <p className="text-[11px] text-ink-3">{blocked}</p> : null}
      {tx ? (
        <div className="bg-paper p-3 text-[12px] px-frame-thin">
          <div className="font-tag text-[10px] uppercase text-ink-3">Prepared · calldata to {short(tx.to)} · chain {tx.chainId}{tx.abiSource === "spec" ? " · spec ABI" : ""}</div>
          <p className="mt-1 break-words font-mono text-[11.5px] text-ink">{tx.summary}</p>
          {tx.simulation ? <p className={cx("mt-1 text-[11.5px]", tx.simulation.ok ? "text-up" : "text-down")}>{tx.simulation.ok ? "eth_call ✓ would succeed now" : `eth_call ✗ ${tx.simulation.error}`}</p> : null}
          {tx.warnings.length > 0 ? (
            <ul className="mt-1.5 list-disc pl-4 text-[11.5px] text-warn-ink">
              {tx.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <details className="mt-1.5">
            <summary className="cursor-pointer font-tag text-[10px] uppercase text-ink-3">calldata</summary>
            <code className="block break-all font-mono text-[10.5px] text-ink-2">{tx.data}</code>
          </details>
        </div>
      ) : null}
      {state.phase === "prepared" ? <SignRow confirm={confirm} onSign={() => void sign(state.tx)} onCancel={reset} variant={variant} /> : null}
      {state.phase === "wallet" ? <p role="status" className="text-[12px] text-ink-2">Check your wallet…</p> : null}
      {state.phase === "pending" ? <p role="status" className="text-[12px] text-ink-2">Sent · waiting for a block ({short(state.hash)})</p> : null}
      {state.phase === "done" ? (
        <p role="status" className="text-[12px] text-up">
          Confirmed · {short(state.hash)}{" "}
          <button type="button" className="underline" onClick={reset}>
            Done
          </button>
        </p>
      ) : null}
      {state.phase === "failed" ? (
        <p role="alert" className="text-[12px] text-down">
          {state.error}{" "}
          <button type="button" className="underline" onClick={reset}>
            Reset
          </button>
        </p>
      ) : null}
    </div>
  );
}

function SignRow({ confirm, onSign, onCancel, variant }: { readonly confirm?: string; readonly onSign: () => void; readonly onCancel: () => void; readonly variant: "primary" | "ink" | "danger" }) {
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = String(new FormData(event.currentTarget).get("confirm") ?? "");
        if (!confirm || typed.trim().toUpperCase() === confirm) onSign();
      }}
    >
      {confirm ? (
        <label className="flex flex-col gap-1 font-tag text-[10px] uppercase text-ink-2">
          Type {confirm} to confirm
          <input name="confirm" autoComplete="off" className="h-9 bg-paper px-2 font-mono text-[13px] uppercase text-ink px-frame-thin" />
        </label>
      ) : null}
      <div className="flex gap-2">
        <Button variant="ink" size="sm" fullWidth onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} size="sm" fullWidth className="portal-pulse">
          Sign in wallet
        </Button>
      </div>
    </form>
  );
}
