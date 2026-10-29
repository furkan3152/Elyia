import { useEffect, useRef, useState } from "react";

/**
 * A value that changes at most once per `everyMs`, always ending on the
 * latest. Elysium's head moves ~9 times a second; the altimeter shows it
 * once a second so its digits roll calmly (and nothing flickers above 3 Hz).
 */
export function useSteady<T>(value: T, everyMs = 1_000): T {
  const [shown, setShown] = useState(value);
  const latest = useRef(value);
  const last = useRef(0);
  useEffect(() => {
    latest.current = value;
    const wait = last.current + everyMs - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      last.current = Date.now();
      setShown(latest.current);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [value, everyMs]);
  return shown;
}
