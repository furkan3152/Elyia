import { useCallback, useMemo } from "react";

import { cx, FOCUS_RING } from "../ui/cx";
import { drawGrid } from "./draw";
import { HERD_ART, herdLabel, herdMember, herdPlaceholderArt, RARITY_FILL, RARITY_LABEL, type HerdMember } from "./herd";
import { PixelCanvas } from "./PixelCanvas";

export interface HerdPortraitProps {
  /** Herd number (1..3333; 0 = the unrevealed placeholder); or pass a generated `member`. */
  readonly id?: number;
  readonly member?: HerdMember;
  /** CSS px per pixel (default 4: 192 x 192). Ignored with `fluid`. */
  readonly scale?: number;
  /** Fill the container width (integer scale, crisp). */
  readonly fluid?: boolean;
  readonly label?: string | null;
  readonly className?: string;
}

/** One Herd Ely (48 x 48), drawn by the same code as the collection's PNGs. */
export function HerdPortrait({ id = 777, member, scale = 4, fluid = false, label, className }: HerdPortraitProps) {
  const placeholder = !member && id === 0;
  const ely = useMemo(() => (placeholder ? null : (member ?? herdMember(id))), [placeholder, member, id]);
  const grid = ely ? ely.grid : herdPlaceholderArt();
  const draw = useCallback((ctx: CanvasRenderingContext2D) => drawGrid(ctx, grid, 0, 0, 1), [grid]);
  const name =
    label === null ? undefined : (label ?? (ely ? `${ely.name}: ${ely.traits.map((trait) => trait.name).join(", ")}; ${RARITY_LABEL[ely.rarity]}` : "An unrevealed Ely in the fog"));
  const key = ely?.id ?? 0;
  if (fluid) {
    return <PixelCanvas width={HERD_ART} height={HERD_ART} contain halo={false} draw={draw} label={name} decorative={label === null} redrawKey={key} className={className} style={{ background: grid[0]![0]! }} />;
  }
  return <PixelCanvas width={HERD_ART} height={HERD_ART} scale={scale} halo={false} draw={draw} label={name} decorative={label === null} redrawKey={key} className={className} />;
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
