import { useCallback } from "react";

import { useFloorStatus, useRidgeHead, useSummitHead, type LayerHead } from "../../../app/shell/useLayerHeads";
import { drawBigEly, drawMiniRange, paletteOf } from "../../../features/ely/draw";
import { SUGGESTIONS } from "./suggestions";
import { Glyph } from "../../../features/ely/ui";
import { formatBlockNumber } from "../../../lib/format";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { cx, FOCUS_RING } from "../../../ui/cx";

function BigEly({ size }: { readonly size: 2 | 3 }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, info: { readonly seconds: number; readonly still: boolean }) => drawBigEly(ctx, info.still ? 0.3 : info.seconds, paletteOf(ctx.canvas)), []);
  return <PixelCanvas width={48} height={48} scale={size} draw={draw} animate fps={12} endTime={0.3} label="Ely, the pixel ibex, waiting on a snowy rock with a head lamp" />;
}

function headWord(head: LayerHead): string {
  if (head.head !== null) return `#${formatBlockNumber(head.head)}`;
  return head.status === "live" ? "live" : head.status === "connecting" ? "…" : head.status;
}

/** Floor, Ridge and Summit as one rising landscape with a beacon per layer; the caption counts the real block heads. */
export function MiniRange({ compact = false }: { readonly compact?: boolean }) {
  const floor = useFloorStatus();
  const ridge = useRidgeHead();
  const summit = useSummitHead();
  const ridgeHead = ridge.head;
  const summitHead = summit.head;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, info: { readonly w: number; readonly h: number; readonly seconds: number; readonly still: boolean }) => {
      const T = info.still ? 0 : info.seconds;
      drawMiniRange(ctx, info.w, info.h, T, paletteOf(ctx.canvas), { floor: Math.floor(T / 0.5), ridge: ridgeHead ?? Math.floor(T), summit: summitHead ?? Math.floor(T / 0.9) });
    },
    [ridgeHead, summitHead],
  );
  const label = `Live mini range: the Floor (HyperCore, ${floor.status}), the Ridge (HyperEVM block ${ridge.head ?? ridge.status}) and the Summit (Elysium block ${summit.head ?? summit.status}).`;
  return (
    <div className="fr flat w-full">
      <PixelCanvas width={200} height={compact ? 18 : 24} pixelSize={4} draw={draw} animate fps={10} label={label} className="m-[2px]" style={{ width: "calc(100% - 4px)" }} />
      {compact ? null : (
        <div className="mr-cap" aria-hidden="true">
          <span>
            ▲ Floor · HyperCore <b className="num">{headWord(floor)}</b>
          </span>
          <span>
            ▲ Ridge · HyperEVM <b className="num">{headWord(ridge)}</b>
          </span>
          <span>
            ▲ Summit · Elysium <b className="num">{headWord(summit)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ onPick, phone }: { readonly onPick: (sentence: string) => void; readonly phone: boolean }) {
  return (
    <div className="flex w-full flex-col items-center text-center">
      <BigEly size={phone ? 2 : 3} />
      <h1 className={cx("disp mt-2 leading-none", phone ? "text-[44px]" : "text-[64px]")}>Where to?</h1>
      <p className={cx("mt-3 max-w-[560px] text-ink-2", phone ? "text-[13px]" : "text-[15px]")}>
        {phone ? "One sentence. Ely drafts the route; your wallet signs every step." : "Ask in one sentence. Ely surveys the Floor, the Ridge and the Summit, drafts the route, and your wallet signs every step."}
      </p>
      <ul className={cx("sugg w-full", phone ? "mt-5 !grid-cols-2 !gap-3" : "mt-8")} aria-label="Suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion.title} className="flex">
            <button type="button" onClick={() => onPick(suggestion.sentence)} className={cx("sg fr w-full", phone && "!min-h-[112px]", FOCUS_RING)} aria-label={`${suggestion.title}: ${suggestion.sentence}`}>
              <Glyph name={suggestion.glyph} scale={3} />
              <b style={phone ? { fontSize: 14 } : undefined}>{suggestion.title}</b>
              {phone ? null : <span>{suggestion.sentence}</span>}
              <span className="lay">{phone ? suggestion.short : suggestion.layer}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={cx("w-full", phone ? "mt-4" : "mt-6")}>
        <MiniRange compact={phone} />
      </div>
    </div>
  );
}
