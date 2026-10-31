import { getEvmNetwork, layersFor, type NetworkEnvironment } from "@elyia/core/networks";
import { useCallback } from "react";
import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { cssVars } from "../../motion/tokens";
import { useReducedMotion } from "../../motion/useReducedMotion";
import { PixelCanvas } from "../../pixel/PixelCanvas";
import { cx } from "../../ui/cx";
import { ROLLUP_PERIOD_ABI } from "../track/flow/abis";
import { withdrawalSeconds } from "../track/flow/orbit";
import { INK, SUN } from "../track/flow/pixelArt";
import { formatEta } from "../track/flow/routeModel";
import { MAINNET_CONFIRM_BLOCKS, TICKET_SURVEY } from "./lanes";

/** A hand-inked stamp in the pixel stamp style (tilted, 2 px frame in its own ink). */
function InkStamp({ text, tone, rotate, delay }: { readonly text: string; readonly tone: "down" | "up"; readonly rotate: number; readonly delay: number }) {
  return (
    <span
      aria-hidden="true"
      data-go="true"
      className="px-stamp px-frame inline-flex whitespace-nowrap px-1.5 py-0.5 font-tag text-[10px] uppercase leading-tight"
      style={cssVars({ "--stamp-c": tone === "down" ? "rgb(var(--down))" : "rgb(var(--up))", "--stamp-rot": `${rotate}deg`, "--el-delay": `${delay}ms` })}
    >
      {text}
    </span>
  );
}

/**
 * The ticket watch: why Elyia follows every ERC-20 ascent. Six pixel ticket
 * stubs are the six live testnet retryables surveyed; five carry the "by
 * hand" stamp. The lifecycle below is what Elyia checks.
 */
export function TicketWatch({ className }: { readonly className?: string }) {
  const stages = [
    ["Created", "the ticket lands on Elysium"],
    ["Auto-redeem", "usually fails on the practice wall"],
    ["Redeem", "one tap, one signature, within 7 days"],
    ["Summit", "tokens credited"],
  ] as const;
  return (
    <section className={cx("flex flex-col bg-card px-frame px-drop", className)} aria-labelledby="ticket-watch">
      <header className="flex flex-col items-center gap-2 border-b-4 border-rule px-5 py-5 text-center">
        <p className="caption">Retryable · 7-day life</p>
        <h3 id="ticket-watch" className="font-display text-[28px] font-bold leading-none text-ink">
          Ticket watch
        </h3>
      </header>
      <div className="flex flex-1 flex-col gap-6 p-5">
        <ol className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6 sm:gap-x-3" aria-label={`${TICKET_SURVEY.manual} of ${TICKET_SURVEY.tickets} surveyed tickets needed a manual redeem`}>
          {Array.from({ length: TICKET_SURVEY.tickets }, (_, index) => {
            const manual = index < TICKET_SURVEY.manual;
            return (
              <li key={index} className={cx("relative flex h-[76px] flex-col items-center justify-between py-2 px-frame-thin", manual ? "bg-paper-2" : "bg-card")} aria-hidden="true">
                <span className="tnum font-tag text-[11px] text-ink-2">#{index + 1}</span>
                <span className="w-full border-t-2 border-dashed border-rule/40" />
                <InkStamp text={manual ? "by hand" : "auto ✓"} tone={manual ? "down" : "up"} rotate={index % 2 === 0 ? -7 : 5} delay={200 + index * 120} />
              </li>
            );
          })}
        </ol>
        <p className="text-center text-[15px] leading-relaxed text-ink text-pretty">
          <span className="font-display text-[20px] font-bold">
            {TICKET_SURVEY.manual} of {TICKET_SURVEY.tickets}
          </span>{" "}
          live testnet tickets needed a manual redeem. Elyia computes your ticket id from the deposit, watches it, and if it stalls asks you once.
        </p>
        <ol className="mt-auto grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stages.map(([title, body], index) => (
            <li key={title} className="flex flex-col items-center gap-1 text-center">
              <span className="flex h-7 w-7 items-center justify-center bg-ink font-tag text-[12px] text-paper">{index + 1}</span>
              <span className="font-tag text-[11px] uppercase text-ink">{title}</span>
              <span className="text-[12px] leading-snug text-ink-2">{body}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const GLASS_W = 17;
const GLASS_H = 25;

/** A pixel hourglass: the sand runs down in steps over a 12 s turn (the end state: a full bottom bulb). */
function paintHourglass(ctx: CanvasRenderingContext2D, seconds: number, still: boolean, night: boolean): void {
  ctx.clearRect(0, 0, GLASS_W, GLASS_H);
  const p = still ? 1 : (seconds % 12) / 12;
  const glass = night ? "#3D5E70" : "#DDF2F6";
  const sand = "#D3A66E";
  // frame plates
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, GLASS_W, 2);
  ctx.fillRect(0, GLASS_H - 2, GLASS_W, 2);
  ctx.fillStyle = "#8A5A2B";
  ctx.fillRect(1, 0, GLASS_W - 2, 1);
  ctx.fillRect(1, GLASS_H - 1, GLASS_W - 2, 1);
  // the two bulbs: half widths per row (symmetric about the waist)
  const rows = GLASS_H - 4;
  const waist = Math.floor(rows / 2);
  const half = (r: number) => {
    const d = Math.abs(r - waist);
    return Math.max(1, Math.round((d / waist) * 6.5));
  };
  const cx = Math.floor(GLASS_W / 2);
  const topSand = Math.round((1 - p) * (waist - 1));
  const bottomSand = Math.round(p * (waist - 1));
  for (let r = 0; r < rows; r += 1) {
    const y = r + 2;
    const hw = half(r);
    ctx.fillStyle = INK;
    ctx.fillRect(cx - hw - 1, y, 1, 1);
    ctx.fillRect(cx + hw + 1, y, 1, 1);
    const inTop = r < waist && r >= waist - topSand;
    const inBottom = r > waist && r > rows - 1 - bottomSand;
    ctx.fillStyle = inTop || inBottom ? sand : glass;
    ctx.fillRect(cx - hw, y, hw * 2 + 1, 1);
  }
  // the falling stream, two pixels that alternate at 2 Hz
  if (!still && p < 0.98) {
    ctx.fillStyle = sand;
    const phase = Math.floor(seconds * 4) % 2;
    for (let y = waist + 2; y < rows + 1 - bottomSand; y += 2) ctx.fillRect(cx, y + phase, 1, 1);
  }
  ctx.fillStyle = SUN;
  ctx.fillRect(cx - 3, 4, 1, 2);
}

/**
 * The descent clock: how long the trail down takes, read from the rollup
 * itself (`confirmPeriodBlocks()` on HyperEVM) for the practice wall, next
 * to the mainnet value Elyia pins (483,840 blocks). A pixel hourglass runs.
 */
export function DescentClock({ mode, night, className }: { readonly mode: NetworkEnvironment; readonly night: boolean; readonly className?: string }) {
  const elysium = getEvmNetwork(layersFor(mode).elysium.key);
  const parent = getEvmNetwork(layersFor(mode).hyperevm.key);
  const rollup = elysium.elysiumBridge?.parent.rollup as Address | undefined;
  const period = useReadContract({ address: rollup, abi: ROLLUP_PERIOD_ABI, functionName: "confirmPeriodBlocks", chainId: parent.chainId, query: { enabled: Boolean(rollup), staleTime: 10 * 60_000 } });
  const live = period.data !== undefined ? Number(period.data) : null;
  const pinned = elysium.elysiumBridge?.confirmPeriodBlocks ?? null;
  const blocks = live ?? pinned;
  // the end state whenever motion is reduced (the shared loop may repaint a still canvas at t = 0)
  const reduced = useReducedMotion();
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => paintHourglass(ctx, info.seconds, info.still || reduced, night), [night, reduced]);
  const rows = [
    { label: "Practice wall", sub: `${blocks?.toLocaleString("en-US") ?? "—"} blocks · ${live !== null ? "read live" : "pinned"}`, value: blocks !== null ? formatEta(withdrawalSeconds(blocks)) : "—", strong: mode === "testnet" },
    { label: "Mainnet", sub: `${MAINNET_CONFIRM_BLOCKS.toLocaleString("en-US")} blocks · pinned`, value: formatEta(withdrawalSeconds(MAINNET_CONFIRM_BLOCKS)), strong: mode === "mainnet" },
  ];
  return (
    <section className={cx("flex flex-col bg-card px-frame px-drop", className)} aria-labelledby="descent-clock">
      <header className="flex flex-col items-center gap-2 border-b-4 border-rule px-5 py-5 text-center">
        <p className="caption">Descent clock · the challenge period</p>
        <h3 id="descent-clock" className="font-display text-[28px] font-bold leading-none text-ink">
          Up by cable car. Down on foot.
        </h3>
      </header>
      <div className="flex flex-1 flex-col items-center gap-6 p-5 text-center">
        <PixelCanvas width={GLASS_W} height={GLASS_H} scale={4} draw={draw} animate fps={8} endTime={0} redrawKey={night} label="Hourglass: the withdrawal waits for the rollup to confirm" />
        <p className="max-w-[440px] text-[14px] leading-relaxed text-ink-2 text-pretty">Deposits reach the Summit in minutes. A withdrawal waits for the rollup to confirm, then you claim it at the Ridge hut.</p>
        <dl className="grid w-full grid-cols-2 gap-6">
          {rows.map((row) => (
            <div key={row.label} className={cx("flex flex-col items-center gap-1 px-3 py-4 px-frame-thin", row.strong ? "bg-signal text-signal-ink" : "bg-card")}>
              <dt className="font-tag text-[11px] uppercase">{row.label}</dt>
              <dd className="tnum font-display text-[28px] font-bold leading-none">{row.value}</dd>
              <dd className="tnum font-mono text-[11px] opacity-80">{row.sub}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-auto font-mono text-[11px] text-ink-3">+ ~30 min assertion cadence · the claim needs one signature on HyperEVM</p>
      </div>
    </section>
  );
}
