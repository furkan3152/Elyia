/**
 * Shock math (pure): "if HYPE moves -20%, which ropes snap?" Every position
 * moves by beta x shock; PnL follows its size; a rope snaps when the new
 * mark crosses the liquidation price. Feeds the Avalanche Bulletin slider.
 */
import { ropeDistance, type RopeSide } from "./rope";
import { avalancheLevel, type AvalancheLevel } from "./conditions";

export interface ShockPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: RopeSide;
  /** Absolute size in coins. */
  readonly size: number;
  readonly mark: number;
  readonly liquidation?: number | null;
  /** Sensitivity to the shocked driver (1 for the driver itself). */
  readonly beta: number;
}

export interface ShockedPosition {
  readonly id: string;
  readonly symbol: string;
  readonly move: number;
  readonly mark: number;
  readonly pnl: number;
  /** Distance before and after the shock (null without a liquidation price). */
  readonly before: number | null;
  readonly after: number | null;
  readonly snapped: boolean;
}

export interface ShockResult {
  readonly shock: number;
  readonly netWorth: number;
  readonly pnl: number;
  readonly positions: readonly ShockedPosition[];
  readonly snapped: number;
  readonly level: AvalancheLevel;
}

/** Shock limits on the slider (-30% ... +30%). */
export const SHOCK_RANGE = 0.3;

export function clampShock(shock: number): number {
  if (!Number.isFinite(shock)) return 0;
  return Math.max(-SHOCK_RANGE, Math.min(SHOCK_RANGE, shock));
}

export function applyShock(positions: readonly ShockPosition[], netWorth: number, shock: number): ShockResult {
  const s = clampShock(shock);
  let pnl = 0;
  let snapped = 0;
  const shocked = positions.map<ShockedPosition>((position) => {
    const move = position.beta * s;
    const mark = Math.max(0, position.mark * (1 + move));
    const direction = position.side === "long" ? 1 : -1;
    const change = direction * position.size * (mark - position.mark);
    const before = ropeDistance(position.side, position.mark, position.liquidation);
    const liq = position.liquidation;
    const crossed =
      typeof liq === "number" && Number.isFinite(liq) && liq > 0 && (position.side === "long" ? mark <= liq : mark >= liq);
    const after = crossed ? 0 : ropeDistance(position.side, mark, position.liquidation);
    if (crossed) snapped += 1;
    pnl += change;
    return { id: position.id, symbol: position.symbol, move, mark, pnl: change, before, after, snapped: crossed };
  });
  const distances = shocked.map((position) => position.after).filter((d): d is number => d !== null);
  const level = avalancheLevel({ minDistance: distances.length > 0 ? Math.min(...distances) : null, snapped });
  return { shock: s, netWorth: netWorth + pnl, pnl, positions: shocked, snapped, level };
}
