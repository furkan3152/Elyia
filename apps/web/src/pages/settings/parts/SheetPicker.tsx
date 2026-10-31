import { useCallback } from "react";

import type { ThemePreference } from "../../../app/state/uiPrefs";
import { drawDisc } from "../../../pixel/draw";
import { drawGrid } from "../../../pixel/draw";
import { elySprite, INK, mini } from "../../../pixel/ely";
import { PixelCanvas } from "../../../pixel/PixelCanvas";
import { rngOf, topoField, fieldMax, bandOf } from "../../../pixel/topo";
import { cx, FOCUS_RING } from "../../../ui/cx";

const W = 64;
const H = 40;
const FIELD = topoField(W, H, 4242, [
  [14, 12, 1, 9],
  [48, 26, 0.9, 11],
  [34, 6, 0.5, 7],
  [6, 34, 0.6, 8],
  [60, 4, 0.5, 7],
]);
const MAX = fieldMax(FIELD);

const SHEETS = {
  day: { paper: "#F2ECDD", card: "#FFF9EC", contour: "#7A5230", ink: INK, disc: "#F2C200", glow: "#FFE27A" },
  night: { paper: "#0E1512", card: "#16211B", contour: "#C9925A", ink: "#EEE7D8", disc: "#DDE6EA", glow: "#2A3D55" },
} as const;

/** A pocket map sheet: contour pixels on paper, a sun or a moon, Ely on the summit pin and a SIGN button, in the sheet's own colours. */
function paintSheet(ctx: CanvasRenderingContext2D, sheet: "day" | "night", from = 0, to = W) {
  const c = SHEETS[sheet];
  ctx.fillStyle = c.paper;
  ctx.fillRect(from, 0, to - from, H);
  ctx.fillStyle = c.contour;
  for (let y = 0; y < H; y += 1) {
    for (let x = from; x < to; x += 1) {
      const b = bandOf(FIELD[y]![x]!, MAX, 6);
      const r = x + 1 < W ? bandOf(FIELD[y]![x + 1]!, MAX, 6) : b;
      const d = y + 1 < H ? bandOf(FIELD[y + 1]![x]!, MAX, 6) : b;
      if (b !== r || b !== d) ctx.fillRect(x, y, 1, 1);
    }
  }
  if (sheet === "night") {
    const random = rngOf(17);
    ctx.fillStyle = "#EEE7D8";
    for (let i = 0; i < 14; i += 1) {
      const x = Math.floor(random() * W);
      const y = Math.floor(random() * 14);
      if (x >= from && x < to) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function paintFull(ctx: CanvasRenderingContext2D, choice: ThemePreference) {
  ctx.clearRect(0, 0, W, H);
  if (choice === "system") {
    paintSheet(ctx, "day", 0, W / 2);
    paintSheet(ctx, "night", W / 2, W);
  } else {
    paintSheet(ctx, choice === "dark" ? "night" : "day");
  }
  const left = choice === "system" ? SHEETS.day : SHEETS[choice === "dark" ? "night" : "day"];
  const right = choice === "system" ? SHEETS.night : left;
  // the sky disc: sun by day, moon by night; split on "follow device"
  if (choice === "system") {
    drawDisc(ctx, 10, 8, 5, SHEETS.day.disc);
    drawDisc(ctx, 54, 8, 5, SHEETS.night.disc);
    drawDisc(ctx, 56, 7, 4, SHEETS.night.paper);
    ctx.fillStyle = INK;
    ctx.fillRect(W / 2, 0, 1, H);
  } else if (choice === "dark") {
    drawDisc(ctx, 54, 8, 5, left.disc);
    drawDisc(ctx, 56, 7, 4, left.paper);
  } else {
    drawDisc(ctx, 54, 8, 5, left.disc);
  }
  // Ely on the centre pin
  drawGrid(ctx, mini(elySprite(choice === "dark" ? { gear: "goggles", fur: "Night", horn: "Obsidian" } : { gear: "lamp" })), W / 2 - 8, 9, 1);
  // a net worth tag (left) and a SIGN button (right), each in its half's colours
  ctx.fillStyle = left.ink;
  ctx.fillRect(3, 31, 18, 7);
  ctx.fillStyle = left.card;
  ctx.fillRect(4, 32, 16, 5);
  ctx.fillStyle = left.ink;
  for (let i = 0; i < 5; i += 1) ctx.fillRect(6 + i * 3, 34, 2, 1);
  ctx.fillStyle = right.ink;
  ctx.fillRect(43, 31, 18, 7);
  ctx.fillStyle = choice === "light" ? "#17788C" : "#6FD3E3";
  ctx.fillRect(44, 32, 16, 5);
  ctx.fillStyle = choice === "light" ? "#FFFFFF" : "#0E1512";
  for (let i = 0; i < 4; i += 1) ctx.fillRect(47 + i * 3, 34, 2, 1);
}

function SheetArt({ choice }: { readonly choice: ThemePreference }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D) => paintFull(ctx, choice), [choice]);
  // The preview paints its own sheet: the NIGHT rim only on the Night sheet.
  return <PixelCanvas width={W} height={H} contain night={choice === "dark"} draw={draw} redrawKey={choice} decorative />;
}

const CHOICES: readonly { readonly value: ThemePreference; readonly name: string; readonly line: string }[] = [
  { value: "light", name: "Day", line: "paper map · the default" },
  { value: "dark", name: "Night", line: "headlamp · easy on the eyes" },
  { value: "system", name: "Follow device", line: "day or night with your system" },
];

/** Theme as three pixel map sheets to choose from, each drawn in its own colours. */
export function SheetPicker({ value, onChange }: { readonly value: ThemePreference; readonly onChange: (value: ThemePreference) => void }) {
  return (
    <div role="radiogroup" aria-label="Map sheet (theme)" className="grid grid-cols-3 gap-4 sm:gap-6">
      {CHOICES.map((choice) => {
        const selected = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(choice.value)}
            className={cx("flex flex-col bg-card text-center px-frame px-press", selected ? "px-drop-lg" : "px-drop", FOCUS_RING)}
          >
            <span className="block border-b-4 border-rule bg-paper-2 p-1.5 sm:p-3">
              <SheetArt choice={choice.value} />
            </span>
            <span className={cx("flex flex-1 flex-col items-center gap-1 px-2 py-3", selected && "bg-signal text-signal-ink")}>
              <span className="flex items-center gap-2 font-display text-[16px] font-bold leading-tight sm:text-[20px]">
                <span aria-hidden="true" className={cx("inline-flex h-4 w-4 items-center justify-center font-tag text-[10px]", selected ? "bg-ink text-paper" : "bg-paper-2")}>
                  {selected ? "✓" : ""}
                </span>
                {choice.name}
              </span>
              <span className={cx("hidden font-mono text-[11px] sm:block", selected ? "text-signal-ink" : "text-ink-3")}>{choice.line}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
