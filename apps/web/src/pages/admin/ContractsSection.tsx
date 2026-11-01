import type { ContractsConfigResponse, DeploymentRecord } from "@elyia/core/api/admin";

import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import type { PortalGlyphName } from "../developers/portal/glyphs";
import { Card, Glyph, KV, Pill, SectionHead, TextStamp } from "../developers/portal/ui";
import { DeployTrack } from "./AdminCanvases";
import { CAMPS, campsDone, codeSize, formatNative, NETWORK_OPTIONS, shortHex, stampOf, walletPhase, type AdminNetwork, type ContractStamp, type Deployable, type DeployState } from "./deployModel";
import { dependsOn, explorerAddress, recordedOn } from "./contracts";
import { ARTIFACTS } from "./useDeploy";

const META: Readonly<Record<Deployable, { readonly glyph: PortalGlyphName; readonly blurb: string }>> = {
  ElyiaRouter: { glyph: "swap", blurb: "split + multicall · fees" },
  ElyAccountFactory: { glyph: "people", blurb: "CREATE2 smart accounts" },
  ElyOrders: { glyph: "clock", blurb: "stops, TP, DCA, TWAP" },
};

const STAMP_TONE: Readonly<Record<ContractStamp, "up" | "acc" | "ink">> = { Verified: "up", Deployed: "acc", Deploying: "acc", "Not deployed": "ink" };

export interface ContractCardProps {
  readonly contract: Deployable;
  readonly network: AdminNetwork;
  readonly config: ContractsConfigResponse | undefined;
  readonly record: DeploymentRecord | undefined;
  readonly flow: DeployState | null;
  readonly selected: boolean;
  readonly onDeploy: () => void;
  readonly extra?: React.ReactNode;
}

export function ContractCard({ contract, network, config, record, flow, selected, onDeploy, extra }: ContractCardProps) {
  const recorded = recordedOn(config, network);
  const address = recorded[contract] ?? null;
  const artifact = ARTIFACTS[contract];
  const stamp = stampOf(flow ?? { phase: "idle" }, address);
  const waiting = dependsOn(contract).filter((dep) => !recorded[dep]);
  const option = NETWORK_OPTIONS.find((entry) => entry.key === network)!;
  const link = address ? explorerAddress(network, address) : null;
  const predicted = flow && "preview" in flow ? flow.preview.predicted : null;
  const landed = flow && "receipt" in flow ? flow.receipt.address : null;
  return (
    <Card accent={selected} emphasis={selected} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Glyph name={META[contract].glyph} scale={3} />
        <div className="min-w-0">
          <h3 className="truncate font-display text-[18px] font-bold leading-tight text-ink">{contract}</h3>
          <div className="font-tag text-[9.5px] uppercase tracking-[0.04em] text-ink-3">
            v{artifact.version} · {META[contract].blurb}
          </div>
          <TextStamp tone={STAMP_TONE[stamp]} className="mt-2" key={stamp}>
            {stamp}
          </TextStamp>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 bg-paper px-2.5 py-2 font-mono text-[12px] text-ink px-frame-thin">
        <span className="truncate">{address ? shortHex(address) : landed ? shortHex(landed) : predicted ? `predicted ${shortHex(predicted)}` : "not deployed"}</span>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer noopener" className="shrink-0 font-tag text-[10px] uppercase text-accent underline-offset-2 hover:underline">
            explorer ↗
          </a>
        ) : (
          <span className="shrink-0 font-tag text-[10px] uppercase text-ink-3">CREATE</span>
        )}
      </div>
      <KV
        rows={
          address && record
            ? [
                ["Block", <span key="b" className="font-mono tnum">{Number(record.blockNumber).toLocaleString("en-US")}</span>],
                ["Bytecode", record.checks.runtimeCodeMatches ? <span key="c" className="text-up">match ✓ {shortHex(record.codeHash, 4, 2)}</span> : <span key="c" className="text-down">mismatch ✗</span>],
                ["Recorded", <span key="r">{record.recordedAt.slice(0, 10)} · {shortHex(record.recordedBy)}</span>],
              ]
            : [
                ["Init code", <span key="s" className="font-mono">{codeSize(artifact.bytecode)} · runs 200</span>],
                ["Artifact", <span key="a" className="font-mono">src {shortHex(artifact.sourceHash, 4, 2)}</span>],
                ["Depends", dependsOn(contract).length === 0 ? "nothing" : dependsOn(contract).map((dep) => `${dep} ${recorded[dep] ? "✓" : "· not yet"}`).join(", ")],
              ]
        }
      />
      {extra}
      <div className="mt-auto grid grid-cols-3 gap-1.5">
        {NETWORK_OPTIONS.map((entry) => {
          const there = recordedOn(config, entry.key)[contract];
          return (
            <div key={entry.key} className={cx("flex flex-col items-center gap-1 bg-paper-2 px-1 py-1.5 text-center font-tag text-[9px] uppercase leading-tight", entry.key === network && "bg-paper-3")}>
              <span aria-hidden="true" className={cx("h-[6px] w-[6px]", there ? "bg-up" : "bg-rule-strong")} />
              <span className="text-ink">{entry.chainId}</span>
              <span className="text-ink-3">{there ? "recorded" : entry.enabled ? "not yet" : "later"}</span>
            </div>
          );
        })}
      </div>
      {!address ? (
        <Button variant="primary" size="sm" fullWidth disabled={!option.enabled || waiting.length > 0 || (flow !== null && flow.phase !== "idle" && flow.phase !== "failed" && flow.phase !== "done")} onClick={onDeploy} className={selected && (!flow || flow.phase === "idle") ? "portal-pulse" : undefined}>
          {!option.enabled ? "Mainnet waits for Nov 9" : waiting.length > 0 ? `Deploy ${waiting.join(", ")} first` : "Deploy with my wallet"}
        </Button>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------------- flow */

const WALLET_STATE = { preview: "preview", request: "signature request", pending: "sent · pending", confirmed: "confirmed", failed: "stopped" } as const;

export interface DeployFlowProps {
  readonly contract: Deployable;
  readonly network: AdminNetwork;
  readonly state: DeployState;
  readonly walletAddress: string | null;
  readonly walletChainId: number | null;
  readonly nativeSymbol: string;
  readonly onPreview: () => void;
  readonly onSign: () => void;
  readonly onReset: () => void;
  /** QA builds only: the flow is driven by a mock, never a wallet. */
  readonly mocked?: boolean;
  /** The selected contract is already recorded on this network (nothing to deploy). */
  readonly recordedAt?: string | null;
}

export function DeployFlow({ contract, network, state, walletAddress, walletChainId, nativeSymbol, onPreview, onSign, onReset, mocked = false, recordedAt = null }: DeployFlowProps) {
  const done = recordedAt && state.phase === "idle" ? 5 : campsDone(state);
  const option = NETWORK_OPTIONS.find((entry) => entry.key === network)!;
  const preview = "preview" in state ? state.preview : state.phase === "failed" && "preview" in state.previous ? state.previous.preview : null;
  const receipt = "receipt" in state ? state.receipt : null;
  const wallet = walletPhase(state);
  const failedCamp = state.phase === "failed" ? CAMPS.findIndex((camp) => camp.id === state.camp) : -1;
  const fee = preview?.gas && preview.gasPriceWei ? formatNative(preview.gas * preview.gasPriceWei) : null;
  return (
    <section id="deployments" aria-labelledby="deploy-title" className="mt-14 scroll-mt-28 border-t-2 border-dashed border-rule pt-14">
      <SectionHead id="deploy-title" tag={`Deploy · ${contract} → ${option.label.split(" · ")[0]}`} title="Five camps. One signature." lede="The same route card language as every trade: each camp settles before the next, and the stamp only lands when the chain proves it." />
      {mocked ? (
        <p className="mb-4 text-center">
          <Pill tone="warn">QA preview · mocked wallet · nothing is broadcast</Pill>
        </p>
      ) : null}
      <Card emphasis className="overflow-hidden p-0">
        <DeployTrack done={done} failed={state.phase === "failed"} />
        <ol className="m-0 grid list-none grid-cols-2 border-t-2 border-rule p-0 sm:grid-cols-5">
          {CAMPS.map((camp, index) => {
            const current = index === done && state.phase !== "done";
            return (
              <li key={camp.id} aria-current={current ? "step" : undefined} className={cx("flex flex-col items-center gap-1 px-2 py-3 text-center", index > 0 && "sm:border-l-2 sm:border-dashed sm:border-rule", current && (failedCamp === index ? "bg-down/10" : "bg-signal/15"))}>
                <span className="font-tag text-[9.5px] uppercase tracking-[0.06em] text-ink-3">Camp {index + 1}</span>
                <b className="font-display text-[14px] text-ink">{camp.title}</b>
                <span className="text-[11px] leading-snug text-ink-3">{camp.detail}</span>
                <span className="mt-1 min-h-[22px]">
                  {index < done ? (
                    <TextStamp tone={index === 4 ? "acc" : "up"}>{camp.stamp}</TextStamp>
                  ) : failedCamp === index ? (
                    <TextStamp tone="dn">Stopped</TextStamp>
                  ) : current ? (
                    <span className="font-tag text-[9.5px] uppercase text-ink-2">{state.phase === "previewing" ? "reading chain…" : state.phase === "signing" ? "in your wallet" : state.phase === "pending" ? "waiting for a block" : state.phase === "verifying" ? "comparing code" : state.phase === "recording" ? "server checks" : "next"}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card className="flex flex-col">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2.5 font-display text-[19px] font-bold text-ink">
              <Glyph name="docs" />
              Preview
            </h3>
            <Pill tone="mute">deterministic</Pill>
          </div>
          {preview ? (
            <KV
              wide
              rows={[
                ["Contract", `${contract}@${ARTIFACTS[contract].version} · src ${shortHex(ARTIFACTS[contract].sourceHash, 4, 2)}`],
                ["Constructor", preview.args.length === 0 ? "no arguments" : preview.args.map((arg) => `${arg.name} ${arg.value.startsWith("0x") ? shortHex(arg.value) : arg.value}`).join(" · ")],
                ["From", <span key="f" className="font-mono">{shortHex(preview.from)} · nonce {preview.nonce}</span>],
                ["Address", <span key="a" className="font-mono">{shortHex(preview.predicted)} (CREATE, nonce {preview.nonce})</span>],
                ["Gas", <span key="g" className="font-mono">{preview.gas ? preview.gas.toLocaleString("en-US") : "estimate failed"}{fee ? ` · ≈ ${fee} ${nativeSymbol}` : ""}</span>],
                ["Simulated", preview.simulationError ? <span key="s" className="text-down">eth_call ✗ · {preview.simulationError}</span> : <span key="s" className="text-up">eth_call ✓ · runtime {preview.simulatedSize?.toLocaleString("en-US")} bytes{preview.simulatedSize !== null && preview.simulatedSize <= 24_576 ? " · size ok" : " · over 24 KB!"}</span>],
                ["Server plan", preview.matchesServerPlan === null ? "not compared (sign in as admin)" : preview.matchesServerPlan ? <span key="m" className="text-up">same creation data ✓</span> : <span key="m" className="text-down">differs ✗</span>],
              ]}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <p className="max-w-[340px] text-[12.5px] text-ink-2">
                {recordedAt ? `${contract} is already recorded here at ${shortHex(recordedAt)}. Every contract on this network is live; pick another network to deploy there.` : "Read the chain first: your nonce, the predicted address, gas and a dry eth_call of the creation code. Nothing is signed."}
              </p>
              {recordedAt ? null : <Button variant="primary" size="sm" loading={state.phase === "previewing"} onClick={onPreview} disabled={!walletAddress || !option.enabled}>
                {walletAddress ? "Preview the deploy" : "Connect the owner wallet"}
              </Button>}
            </div>
          )}
          {state.phase === "failed" ? (
            <div className="mt-4 bg-down/10 p-3 text-[12px] text-ink px-frame-thin px-tone-down" role="alert">
              <b className="text-down">Stopped at camp {failedCamp + 1}.</b> {state.error}
              <div className="mt-2 flex gap-2">
                <Button variant="ink" size="xs" onClick={onReset}>
                  Start over
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
        <Card flat className="flex flex-col overflow-hidden p-0" aria-live="polite">
          <div className="flex items-center gap-2.5 bg-[#16201B] px-4 py-2.5 font-tag text-[10px] uppercase tracking-[0.06em] text-[#CFEFF3]">
            <Glyph name="wallet" />
            Your wallet · {walletAddress ? shortHex(walletAddress) : "not connected"}
            <span className="flex-1" />
            <span className={wallet === "failed" ? "text-[#FF9E8F]" : wallet === "confirmed" ? "text-[#5FD39A]" : "text-[#F6DA72]"}>{WALLET_STATE[wallet]}</span>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <b className="font-display text-[20px] text-ink">{wallet === "confirmed" ? "Contract deployed" : "Deploy contract"}</b>
              <Pill tone="acc">{option.label.split(" · ")[0]}</Pill>
            </div>
            {receipt ? (
              <div className="bg-paper p-3 text-[12px] px-frame-thin">
                <b className="text-up">Receipt · status 1</b>
                <div className="mt-1 font-mono text-ink-2 tnum">
                  block {Number(receipt.blockNumber).toLocaleString("en-US")} · contract {shortHex(receipt.address)} · gas {Number(receipt.gasUsed).toLocaleString("en-US")}
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink-3">tx {shortHex(receipt.hash, 6, 6)}</div>
              </div>
            ) : (
              <KV
                rows={[
                  ["Data", preview ? `${codeSize(preview.data)} init code` : "—"],
                  ["Network fee", fee ? `≈ ${fee} ${nativeSymbol}` : "—"],
                  ["Interacting", "new contract (to: none)"],
                  ["Chain", walletChainId === option.chainId || !walletChainId ? String(option.chainId) : `wallet on ${walletChainId}: switches first`],
                ]}
              />
            )}
            {state.phase === "done" ? <p className="text-[12px] text-up">Recorded {state.recordedAt.slice(0, 19).replace("T", " ")} UTC · live in /v1/config/contracts.</p> : null}
            <div className="mt-auto flex gap-2.5">
              <Button variant="ink" fullWidth disabled={state.phase !== "ready"} onClick={onReset}>
                Reject
              </Button>
              <Button
                variant="primary"
                fullWidth
                disabled={!(state.phase === "ready" || (state.phase === "failed" && state.camp === "sign" && preview))}
                loading={state.phase === "signing" || state.phase === "pending" || state.phase === "verifying" || state.phase === "recording"}
                onClick={onSign}
                className={state.phase === "ready" ? "portal-pulse" : undefined}
              >
                {state.phase === "done" ? "Done ✓" : state.phase === "pending" ? "Pending…" : "Sign"}
              </Button>
            </div>
            <p className="text-[11px] text-ink-3">Your wallet shows the real request; this panel mirrors it. Elyia holds no deployer key.</p>
          </div>
        </Card>
      </div>
    </section>
  );
}
