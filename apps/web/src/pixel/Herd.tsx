import { useCallback, useMemo } from "react";

import { cx, FOCUS_RING } from "../ui/cx";
import { drawGrid } from "./draw";
import { ELY_H, ELY_W, LAYERS } from "./ely";
import { herdLabel, herdMember, RARITY_FILL, RARITY_LABEL, type HerdMember } from "./herd";
import { PixelCanvas } from "./PixelCanvas";
import { drawTopo } from "./topo";

export interface HerdPortraitProps {
  /** Herd number (1..9999); or pass a generated `member`. */
  readonly id?: number;
  readonly member?: HerdMember;
  /** CSS px per pixel (default 4: 128 x 136). Ignored with `fluid`. */
  readonly scale?: number;
  /** Fill the container width (integer scale, crisp). */
  readonly fluid?: boolean;
  readonly label?: string | null;
  readonly className?: string;
}

/** One Herd Ely on its layer's elevation map (32 x 34 pixels). */
export function HerdPortrait({ id = 777, member, scale = 4, fluid = false, label, className }: HerdPortraitProps) {
  const ely = useMemo(() => member ?? herdMember(id), [member, id]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      drawTopo(ctx, ely.field, LAYERS[ely.layer]);
      drawGrid(ctx, ely.grid, 0, 0, 1);
    },
    [ely],
  );
  const name = label === null ? undefined : (label ?? `Ely ${herdLabel(ely.id)}: ${ely.traits.map((trait) => trait.name).join(", ")}; ${RARITY_LABEL[ely.rarity]}`);
  if (fluid) {
    return (
      <PixelCanvas width={ELY_W} height={ELY_H} contain draw={draw} label={name} decorative={label === null} redrawKey={ely.id} className={className} style={{ background: LAYERS[ely.layer][0] }} />
    );
  }
  return <PixelCanvas width={ELY_W} height={ELY_H} scale={scale} draw={draw} label={name} decorative={label === null} redrawKey={ely.id} className={className} />;
}

export function RarityBadge({ rarity, className }: { readonly rarity: HerdMember["rarity"]; readonly className?: string }) {
  const fill = RARITY_FILL[rarity];
  return (
    <span className={cx("inline-flex h-5 items-center px-1.5 font-tag text-[11px] uppercase", fill ? "text-[#16201B]" : "text-ink-2 px-frame-thin", className)} style={fill ? { background: fill } : undefined}>
      {RARITY_LABEL[rarity]}
    </span>
  );
}

export interface HerdCardProps {
  readonly id: number;
  /** Makes the card a button (show this Ely). */
  readonly onSelect?: (id: number) => void;
  readonly selected?: boolean;
  readonly className?: string;
}

/** A Herd card: the portrait edge to edge, then the number and the rarity. A button when `onSelect` is given. */
export function HerdCard({ id, onSelect, selected = false, className }: HerdCardProps) {
  const member = useMemo(() => herdMember(id), [id]);
  const body = (
    <>
      <HerdPortrait member={member} fluid label={null} />
      <span className="flex items-center justify-between gap-2 px-3 py-2.5 font-tag text-[12px] uppercase text-ink">
        <span className="tnum">{herdLabel(id)}</span>
        <RarityBadge rarity={member.rarity} />
      </span>
    </>
  );
  const frame = cx("block w-full bg-card text-left px-frame", selected ? "px-tone-signal px-drop-lg" : "px-drop", className);
  if (!onSelect) {
    return (
      <figure className={cx("m-0", frame)} aria-label={`Ely ${herdLabel(id)}, ${RARITY_LABEL[member.rarity]}`}>
        {body}
      </figure>
    );
  }
  return (
    <button type="button" aria-pressed={selected} aria-label={`Show Ely ${herdLabel(id)}, ${RARITY_LABEL[member.rarity]}`} onClick={() => onSelect(id)} className={cx(frame, "px-press", FOCUS_RING)}>
      {body}
    </button>
  );
}
