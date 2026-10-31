import { useSyncExternalStore } from "react";

import { mediaMatches, subscribeMedia } from "../../../app/state/media";

const WIDE = "(min-width: 1024px)";
const serverFalse = () => false;

/** True on wide screens: the stage draws at 5 px per pixel there (Ely about 170 px tall), 4 px on tablets and phones. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(WIDE, onChange),
    () => mediaMatches(WIDE) === true,
    serverFalse,
  );
}
