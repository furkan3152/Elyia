import { useCallback, useRef } from "react";

import { PixelCanvas } from "../../pixel/PixelCanvas";
import { rngOf } from "../../pixel/topo";
import { AVATAR, drawFlag, drawLand, drawMini, smooth, SUN, tokenReader, type FlagState } from "../developers/portal/canvasKit";

const TRACK_H = 28;
const CAMP_U = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/**
 * "Five camps. One signature.": the trail rises Floor → Ridge → Summit; a
 * camp's flag turns rope red (waving) once its step is proven, the next one is
 * sun, and Ely walks the dotted path to the head (summit pose at the end).
 * `done` is 0-5; the walk between camps eases in when `done` changes.
 */
export function DeployTrack({ done, failed = false }: { readonly done: number; readonly failed?: boolean }) {
  const moved = useRef<{ readonly done: number; readonly at: number | null }>({ done, at: null });
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const token = tokenReader(ctx.canvas);
      const W = info.w;
      if (moved.current.done !== done || moved.current.at === null) moved.current = { done, at: info.seconds };
      const walk = info.still ? 1 : Math.min(1, (info.seconds - (moved.current.at ?? info.seconds)) / 1.2);
      ctx.clearRect(0, 0, W, info.h);
      const tops = drawLand(ctx, W, info.h, (u) => 0.2 + 0.55 * smooth(0, 1, u) + 0.03 * Math.sin(u * 40), (u) => (u < 0.34 ? "floor" : u < 0.67 ? "ridge" : "summit"), 3, 10);
      const camps = CAMP_U.map((u) => Math.round(u * (W - 1)));
      // head: from the last settled camp towards the next as the walk eases in
      const at = Math.max(0, Math.min(4, done - 1));
      const from = done <= 0 ? camps[0]! : camps[Math.max(0, at - (walk < 1 ? 1 : 0))]!;
      const to = done <= 0 ? camps[0]! : camps[at]!;
      const head = Math.round(from + (to - from) * (walk < 1 ? walk : 1));
      for (let s = 0; s < 4; s += 1) {
        const a = camps[s]!;
        const b = camps[s + 1]!;
        for (let i = a; i <= b; i += 1) {
          const walked = i <= head && done > 0;
          if (walked ? i % 2 === 0 : i % 3 === 0) {
            ctx.fillStyle = walked ? token("--accent") : token("--rule-strong");
            ctx.fillRect(i, tops[i]! - 2, 1, 1);
          }
        }
      }
      camps.forEach((x, index) => {
        const state: FlagState = index < done ? "done" : index === done ? "next" : "todo";
        drawFlag(ctx, x, tops[x]! - 2, failed && index === done ? "todo" : state, info.seconds, token, info.still);
      });
      const moving = walk < 1 && done > 0;
      const traits = done >= 5 ? AVATAR.summit : failed ? AVATAR.worry : moving ? AVATAR.climb : AVATAR.idle;
      const bob = moving && !info.still ? Math.floor(info.seconds * 6) % 2 : 0;
      drawMini(ctx, traits, Math.max(0, Math.min(W - 16, head - 8)), tops[Math.max(0, Math.min(W - 1, head))]! - 19 - bob);
    },
    [done, failed],
  );
  return <PixelCanvas width={239} height={TRACK_H} pixelSize={4} draw={draw} animate fps={15} endTime={99} redrawKey={`${done}|${failed}`} label={`Deployment trail: ${done} of 5 camps settled${failed ? ", stopped at a failure" : ""}`} />;
}

/** The kill switch: a red button under a hinged glass cover, a status LED at 1 Hz (green running, red paused). */
export function KillSwitch({ paused, label }: { readonly paused: boolean | null; readonly label: string }) {
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => {
      const styles = getComputedStyle(ctx.canvas);
      const v = (name: string) => styles.getPropertyValue(name).trim() || "#2e3a34";
      ctx.clearRect(0, 0, 30, 30);
      ctx.fillStyle = v("--bv-ink");
      ctx.fillRect(3, 6, 24, 22);
      ctx.fillStyle = v("--bv-ink-hi");
      ctx.fillRect(3, 6, 24, 1);
      ctx.fillRect(3, 6, 1, 22);
      ctx.fillStyle = SUN;
      for (let i = 0; i < 24; i += 4) ctx.fillRect(3 + i, 26, 2, 2);
      const pressed = paused === true ? 1 : 0;
      for (let y = -8; y <= 8; y += 1) {
        const w = Math.round(Math.sqrt(64 - y * y));
        ctx.fillStyle = y < -3 ? "#E2584A" : y < 4 ? "#C62D1F" : "#8F1F15";
        ctx.fillRect(15 - w, 16 + y + pressed, w * 2, 1);
      }
      ctx.fillStyle = "#FFA198";
      ctx.fillRect(11, 10 + pressed, 3, 1);
      ctx.fillRect(10, 11 + pressed, 2, 1);
      // hinged cover: closed glass while running, lifted while paused
      ctx.fillStyle = "rgba(176,237,245,.35)";
      ctx.fillRect(5, paused ? 0 : 3, 20, 3);
      ctx.fillStyle = v("--bv-paper-sh");
      ctx.fillRect(5, paused ? 0 : 3, 20, 1);
      const on = info.still || Math.floor(info.seconds) % 2 === 0;
      ctx.fillStyle = paused === null ? "#8A8A8A" : paused ? (on ? "#FF6B5E" : "#8F1F15") : on ? "#5FD39A" : "#1F7A4C";
      ctx.fillRect(24, 8, 2, 2);
    },
    [paused],
  );
  return <PixelCanvas width={30} height={30} scale={4} draw={draw} animate fps={4} endTime={0} redrawKey={String(paused)} label={label} />;
}

/** A tiny barograph of recent samples (newest right). Warn samples in sun. */
export function MiniBaro({ samples, warnAbove, label }: { readonly samples: readonly number[]; readonly warnAbove?: number; readonly label: string }) {
  const key = samples.join(",");
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const token = tokenReader(ctx.canvas);
      ctx.clearRect(0, 0, 70, 10);
      const list = samples.slice(-35);
      const max = Math.max(...list, 1);
      list.forEach((value, index) => {
        const x = 70 - (list.length - index) * 2;
        const h = Math.max(1, Math.round((value / max) * 8));
        ctx.fillStyle = warnAbove !== undefined && value > warnAbove ? SUN : token("--accent");
        ctx.fillRect(x, 10 - h, 1, h);
      });
      if (list.length === 0) {
        const r = rngOf(7);
        ctx.fillStyle = token("--rule");
        for (let i = 0; i < 70; i += 2) ctx.fillRect(i, 9 - Math.round(r() * 2), 1, 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `samples`
    [key, warnAbove],
  );
  return <PixelCanvas width={70} height={10} scale={2} draw={draw} redrawKey={key} label={label} />;
}
