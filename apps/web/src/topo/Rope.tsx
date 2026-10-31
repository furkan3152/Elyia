import { PixelRope, type PixelRopeProps } from "../pixel/PixelRope";

export type RopeProps = PixelRopeProps;

/**
 * The Rope: a position as a pitch from crevasse (liquidation) through anchor
 * (stop) and climber (mark) to the flag (take-profit). Wraps the pixel rope;
 * it frays under 10% and Ely looks worried.
 */
export function Rope(props: RopeProps) {
  return <PixelRope {...props} />;
}
