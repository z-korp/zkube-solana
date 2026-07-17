import { useEffect, useState } from "react";

/**
 * Current epoch milliseconds, re-read every `intervalMs` while mounted.
 * Pass `null` to pause the interval and keep the mount-time value.
 */
export function useNowTick(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/**
 * Seconds remaining until `endUnixSeconds`, clamped at zero and ticking once
 * per second. An undefined end time returns 0 without starting a timer.
 */
export function useCountdown(endUnixSeconds: number | undefined): number {
  const now = useNowTick(endUnixSeconds === undefined ? null : 1_000);
  if (endUnixSeconds === undefined) return 0;
  return Math.max(0, endUnixSeconds - Math.floor(now / 1_000));
}
