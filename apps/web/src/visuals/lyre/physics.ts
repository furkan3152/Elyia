/**
 * Physics-lite for the Lyre's strings (pure). Each string is a damped
 * standing wave plus a slow hum:
 *
 *   y(x, t) = [E(t)·sin(φ(t)) + H·sin(ψ(t))] · sin(π·x)
 *   E(t) = E0·e^(−λ·t)   (a pluck; λ falls as volatility rises: slack strings ring longer)
 *   H    = HUM_SCALE · amplitude   (continuous hum ∝ short-term volatility)
 *
 * `x` is the position along the string in 0..1 (0 and 1 are the fixed ends).
 * Displacement is normalised; the renderer scales it to pixels.
 */

export interface StringState {
  /** Pluck energy (0..~1.2), decays exponentially. */
  readonly energy: number;
  /** Phase of the pluck oscillation (radians). */
  readonly phase: number;
  /** Phase of the hum (radians). */
  readonly humPhase: number;
}

export interface StringParams {
  /** 0..1: hum amplitude (short-term realized volatility). */
  readonly amplitude: number;
  /** Pluck oscillation frequency in Hz (visual, not audio). */
  readonly frequency: number;
  /** Hum frequency in Hz (slow sway). */
  readonly humFrequency: number;
  /** Damping λ per second. */
  readonly damping: number;
}

export const INITIAL_STRING: StringState = Object.freeze({ energy: 0, phase: 0, humPhase: 0 });

/** Hum is a gentle sway: at most this fraction of a full pluck. */
export const HUM_SCALE = 0.16;
/** Below this the pluck has visually stopped. */
export const SETTLED_ENERGY = 0.004;
export const MAX_ENERGY = 1.2;

const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/**
 * Parameters for string `index` of `count` with a volatility `amplitude`.
 * Frequencies follow a pentatonic ladder so neighbours never move in lockstep.
 */
export function stringParams(index: number, count: number, amplitude: number): StringParams {
  const ladder = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4, 5 / 2, 8 / 3];
  const ratio = ladder[Math.max(0, Math.min(ladder.length - 1, Math.round((index / Math.max(1, count - 1)) * (Math.min(count, ladder.length) - 1))))]!;
  const a = clamp01(amplitude);
  return {
    amplitude: a,
    frequency: 6.5 * ratio,
    humFrequency: 0.45 + 0.9 * a + 0.07 * index,
    damping: 2.6 - 1.4 * a,
  };
}

/** A pluck adds energy (a re-pluck keeps part of the ringing) and restarts the phase. */
export function pluckString(state: StringState, strength = 1): StringState {
  const add = clamp01(strength);
  return { energy: Math.min(MAX_ENERGY, state.energy * 0.4 + add), phase: 0, humPhase: state.humPhase };
}

/** Advances a string by `dtMs`. */
export function stepString(state: StringState, dtMs: number, params: StringParams): StringState {
  const dt = Math.max(0, dtMs) / 1000;
  const energy = state.energy * Math.exp(-params.damping * dt);
  return {
    energy: energy < SETTLED_ENERGY ? 0 : energy,
    phase: (state.phase + TAU * params.frequency * dt) % TAU,
    humPhase: (state.humPhase + TAU * params.humFrequency * dt) % TAU,
  };
}

/** Normalised displacement at position `x` (0..1) along the string. */
export function stringOffset(state: StringState, params: StringParams, x: number): number {
  const envelope = Math.sin(Math.PI * clamp01(x));
  return (state.energy * Math.sin(state.phase) + HUM_SCALE * params.amplitude * Math.sin(state.humPhase)) * envelope;
}

/** Half-width of the vibration blur band at the string's middle (normalised): what the eye sees of a fast string. */
export function blurWidth(state: StringState): number {
  return state.energy;
}

/** True when no string is ringing from a pluck (hum alone may continue). */
export function isSettled(states: readonly StringState[]): boolean {
  return states.every((state) => state.energy < SETTLED_ENERGY);
}

/** True when any string moves at all (pluck or hum): the frame loop may stop otherwise. */
export function isMoving(states: readonly StringState[], params: readonly StringParams[]): boolean {
  return !isSettled(states) || params.some((p) => p.amplitude > 0.001);
}
