import type { HerdConfigResponse } from "@elyia/core/api/herd";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo } from "react";

import { useProof } from "../../../features/herd/herdApi";
import { countdown, formatHype, mintCard, PHASE_LABEL, short } from "../../../features/herd/herdModel";
import { useMint } from "../../../features/herd/useMint";
import { useNow } from "../../../hooks/useNow";
import { Button, ButtonLink } from "../../../ui/Button";
import { cx } from "../../../ui/cx";
import { BlockBar, Chip, Fact } from "./ui";

/**
 * The mint card: live supply, the phase and its price, and the one action
 * this wallet can take right now (every case is in herdModel.mintCard). The
 * WL proof is fetched for the connected wallet; the wallet signs the mint.
 */
export function MintCard({ config }: { readonly config: HerdConfigResponse | null | undefined }) {
  const now = useNow(1_000);
  const mint = useMint(config);
  const proof = useProof(mint.address, config?.phase === "wl");
  const state = useMemo(
    () => mintCard({ config, wallet: mint.address, walletChainId: mint.chainId, mintedId: mint.mintedId, proof: config?.phase === "wl" ? (proof.isError ? null : proof.data) : null, balanceWei: mint.balanceWei, now }),
    [config, mint.address, mint.chainId, mint.mintedId, mint.balanceWei, proof.data, proof.isError, now],
  );
  const { openConnectModal } = useConnectModal();
  const total = config?.totalSupply ?? 0;
  const max = config?.admin?.maxMintable ?? config?.maxSupply ?? 3333;
  const left = state.until ? countdown(state.until, now) : null;
  const busy = mint.tx.state === "wallet" || mint.tx.state === "pending";

  let button: React.ReactNode = null;
  if (state.status === "connect") button = <Button variant="primary" size="lg" fullWidth onClick={openConnectModal} className="portal-pulse">Connect wallet</Button>;
  else if (state.status === "wrong-network") button = <Button variant="primary" size="lg" fullWidth onClick={() => void mint.switchNetwork()}>Switch to {config?.testnet ? "Elysium testnet" : "Elysium"}</Button>;
  else if (state.status === "ready" && state.action) {
    const action = state.action;
    button = (
      <Button variant="primary" size="lg" fullWidth loading={busy} onClick={() => void mint.mint(action)} className={mint.tx.state === "idle" ? "portal-pulse" : undefined}>
        {mint.tx.state === "pending" ? "Minting…" : `Mint for ${formatHype(action.value)}`}
      </Button>
    );
  } else if (state.status === "not-listed" || state.status === "not-deployed" || state.status === "closed" || state.status === "upcoming") button = <ButtonLink to="/herd/wl" variant="ink" size="lg" fullWidth>Apply for the WL</ButtonLink>;
  else if (state.status === "sold-out" && config?.links.marketplace) button = <a href={config.links.marketplace} target="_blank" rel="noreferrer noopener" className="block"><Button variant="signpost" size="lg" fullWidth>Trade on Kalos ↗</Button></a>;

  return (
    <div className="flex h-full flex-col gap-4 bg-card p-5 px-frame px-drop-lg sm:p-6" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chip tone={config?.phase === "wl" || config?.phase === "public" ? "up" : "mute"}>Phase · {config?.phase ? PHASE_LABEL[config.phase] : config?.source === "not-deployed" ? "not deployed" : "—"}</Chip>
        {config?.paused ? <Chip tone="dn">Paused</Chip> : null}
        <span className="font-tag text-[10px] uppercase text-ink-3">1 per wallet · on chain</span>
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[44px] font-bold leading-none text-ink tnum">{config?.totalSupply === null || config?.totalSupply === undefined ? "—" : total.toLocaleString("en-US")}</span>
          <span className="font-tag text-[11px] uppercase text-ink-2">of {max.toLocaleString("en-US")} minted</span>
        </div>
        <div className="mt-3">
          <BlockBar fraction={max > 0 ? total / max : 0} label={`${total} of ${max} minted`} />
        </div>
      </div>
      <div className={cx("p-3.5 px-frame-thin", state.tone === "dn" ? "bg-down/10" : state.tone === "warn" ? "bg-warn/15" : state.tone === "up" ? "bg-up/10" : "bg-paper")}>
        <div className="flex items-center justify-between gap-2">
          <b className="font-display text-[19px] text-ink">{state.title}</b>
          {left ? <Chip tone="acc">{state.status === "upcoming" || state.status === "closed" ? `in ${left}` : `${left} left`}</Chip> : null}
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{state.detail}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-5">
        <Fact label="Price now">{state.quote?.wei ? formatHype(state.quote.wei) : config?.timeline.find((window) => window.phase === "public") ? formatHype(config.timeline.find((window) => window.phase === "public")!.priceWei) : config?.testnet ? "3 HYPE (planned)" : "—"}</Fact>
        <Fact label="Source">{state.quote ? (state.quote.source === "fixed" ? "fixed" : state.quote.source === "unavailable" ? "oracle down" : `${state.quote.source} · USD-pegged`) : "—"}</Fact>
        <Fact label="Your wallet">{mint.address ? short(mint.address) : "not connected"}</Fact>
        <Fact label="Balance">{mint.balanceWei !== null ? formatHype(mint.balanceWei) : "—"}</Fact>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        {button}
        {mint.tx.state === "pending" ? <p role="status" className="text-[12px] text-ink-2">Sent · waiting for a block ({short(mint.tx.hash)})</p> : null}
        {mint.tx.state === "wallet" ? <p role="status" className="text-[12px] text-ink-2">Check your wallet: confirm the mint.</p> : null}
        {mint.tx.state === "done" ? <p role="status" className="text-[12px] text-up">Minted{mint.tx.tokenId ? ` Ely #${mint.tx.tokenId}` : ""} ✓ · tx {short(mint.tx.hash)}</p> : null}
        {mint.tx.state === "failed" ? (
          <p role="alert" className="text-[12px] text-down">
            {mint.tx.error}{" "}
            <button type="button" className="underline" onClick={mint.reset}>
              Dismiss
            </button>
          </p>
        ) : null}
        <p className="text-[11px] leading-snug text-ink-3">Your wallet signs the mint. Elyia holds no key and sends nothing for you.{state.status === "ready" && state.action?.functionName !== "mintPublic" ? " Your WL proof was fetched for this wallet." : ""}</p>
      </div>
    </div>
  );
}
