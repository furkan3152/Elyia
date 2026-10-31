/**
 * Ely's states (pure drawing). Each state is a trait set plus a small effect
 * loop: idle blinks, climb rides a rope, summit plants a flag in confetti,
 * worry shakes with a sweat drop, sleep breathes z's, watch sweeps a lamp
 * beam, talk flaps the mouth (the Guide speaking).
 */
import { drawGrid } from "./draw";
import { elySprite, INK, ROPE_RED, SUN, AQUA, WHITE, type ElyTraits, type PixelGrid } from "./ely";
import type { TextSurface } from "./scene";

export const ELY_STATES = ["idle", "climb", "summit", "worry", "sleep", "watch", "talk"] as const;
export type ElyState = (typeof ELY_STATES)[number];

/** Canvas size for a state sprite: Ely plus room for its effects. */
export const STATE_W = 40;
export const STATE_H = 44;

/** Traits each state dresses Ely in (merged under the caller's traits). */
export const STATE_TRAITS: Readonly<Record<ElyState, ElyTraits>> = {
  idle: { gear: "lamp" },
  climb: { gear: "rope", eye: "happy" },
  summit: { gear: "crown", eye: "happy", mouth: "grin" },
  worry: { gear: "rope", eye: "worried", mouth: "o" },
  sleep: { gear: "cap", eye: "sleep", mouth: "flat", fur: "Snow" },
  watch: { gear: "goggles", fur: "Night", horn: "Obsidian" },
  talk: { gear: "lamp", mouth: "smile" },
};

/** What each state means in the interface (for labels and the map key). */
export const STATE_MEANING: Readonly<Record<ElyState, { readonly title: string; readonly detail: string; readonly where: string }>> = {
  idle: { title: "Idle", detail: "Blinks; the headlamp is on.", where: "Menus · waiting for you" },
  climb: { title: "Climbing", detail: "Something is in flight: up the rope.", where: "Loaders · route steps" },
  summit: { title: "Summit", detail: "The chain proved it: crown and flag.", where: "Success · stamps" },
  worry: { title: "Holding on", detail: "A rope is under 10% to liquidation.", where: "Risk warnings" },
  sleep: { title: "Asleep", detail: "No positions, all quiet.", where: "Empty states · night" },
  watch: { title: "On watch", detail: "The keeper is on: the beam sweeps.", where: "Guide · keeper · night" },
  talk: { title: "Talking", detail: "The Guide is speaking to you.", where: "Guide messages · toasts" },
};

export interface StateFrame {
  readonly state: ElyState;
  readonly seconds: number;
  readonly traits?: ElyTraits;
  /** End state (reduced motion): no shake, no flap, effects frozen at a readable pose. */
  readonly still?: boolean;
  /** Clear before drawing (default true). */
  readonly clear?: boolean;
}

interface Clearable extends TextSurface {
  clearRect(x: number, y: number, w: number, h: number): void;
}

function spriteFor(state: ElyState, traits: ElyTraits | undefined, variant: Partial<ElyTraits> = {}): PixelGrid {
  return elySprite({ ...STATE_TRAITS[state], ...traits, ...variant });
}

/** Paints one frame of an Ely state on a 40 x 44 canvas. */
export function drawElyState(ctx: Clearable, frame: StateFrame): void {
  const { state, traits, still = false } = frame;
  const T = still ? 0.6 : frame.seconds;
  if (frame.clear !== false) ctx.clearRect(0, 0, STATE_W, STATE_H);
  let dy = 6;
  let dx = 4;
  let sprite = spriteFor(state, traits);
  switch (state) {
    case "idle": {
      if (!still) dy += Math.floor(T * 2) % 2;
      if (!still && Math.floor(T * 10) % 30 === 0) sprite = spriteFor(state, traits, { eye: "blink" });
      break;
    }
    case "talk": {
      if (!still) dy += Math.floor(T * 2) % 2;
      const open = !still && Math.floor(T * 5) % 2 === 0;
      sprite = spriteFor(state, traits, { mouth: open ? "o" : "smile" });
      // speech pips
      ctx.fillStyle = INK;
      const pips = still ? 3 : (Math.floor(T * 2.5) % 3) + 1;
      for (let i = 0; i < pips; i += 1) ctx.fillRect(34 + i * 2 - 2, 4, 1, 1);
      ctx.fillRect(32, 6, 1, 1);
      break;
    }
    case "climb": {
      for (let y = 0; y < STATE_H; y += 2) {
        // the braid climbs 5 steps a second: each pixel changes colour 2.5 times a second, under the 3 Hz flash limit
        ctx.fillStyle = (y / 2 + Math.floor(T * 5)) % 2 ? SUN : ROPE_RED;
        ctx.fillRect(19, y, 2, 2);
      }
      dy = still ? 8 : 8 + Math.round(Math.sin(T * 5) * 3);
      break;
    }
    case "summit": {
      dy = still ? 6 : 7 - Math.round(Math.abs(Math.sin(T * 4)) * 2);
      ctx.fillStyle = INK;
      ctx.fillRect(35, 0, 1, 14);
      ctx.fillStyle = ROPE_RED;
      const wave = still ? 0 : Math.floor(T * 4) % 2;
      ctx.fillRect(36, 1, 4 - wave, 2);
      ctx.fillRect(36, 3, 3 + wave, 2);
      const colors = [SUN, AQUA, ROPE_RED, WHITE];
      for (let i = 0; i < 8; i += 1) {
        ctx.fillStyle = colors[i % colors.length]!;
        ctx.fillRect((i * 7 + 3) % 38, Math.floor((T * 12 + i * 9) % STATE_H), 1, 1);
      }
      break;
    }
    case "worry": {
      if (!still) dx = 4 + (Math.floor(T * 6) % 4 === 0 ? 1 : 0);
      ctx.fillStyle = AQUA;
      const d = still ? 2 : Math.floor((T * 10) % 10);
      ctx.fillRect(32, 12 + d, 2, 2);
      ctx.fillRect(33, 11 + d, 1, 1);
      break;
    }
    case "sleep": {
      ctx.fillStyle = INK;
      ctx.font = "8px Silkscreen";
      ctx.textBaseline = "alphabetic";
      const z = still ? 4 : (T * 6) % 14;
      ctx.fillText("z", 30, 12 - z / 2);
      ctx.fillText("z", 34, 6 - ((z + 7) % 14) / 2);
      break;
    }
    case "watch": {
      const a = still ? 0.4 : Math.sin(T * 1.5);
      ctx.fillStyle = "rgba(242,194,0,0.45)";
      for (let y = 0; y < 26; y += 1) {
        const w = Math.round(y * 0.6);
        ctx.fillRect(Math.round(20 + a * y * 0.4 - w), 14 + y, w * 2, 1);
      }
      break;
    }
    default:
      break;
  }
  drawGrid(ctx, sprite, dx, dy - 4, 1);
}
