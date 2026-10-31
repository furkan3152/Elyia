import { PixelAltimeter, type PixelAltimeterProps } from "../pixel/PixelAltimeter";

export type AltimeterProps = PixelAltimeterProps;

/** The altimeter (wraps PixelAltimeter): pixel digit blocks, only changed digits roll. Money is never tweened. */
export function Altimeter(props: AltimeterProps) {
  return <PixelAltimeter {...props} />;
}
