import { useCallback, useEffect, useRef, useState } from "react";

export type FlashStatus = "idle" | "ok" | "err";

/**
 * Transient action feedback: flash "ok" or "err" for a moment, then fall back
 * to "idle". Re-flashing restarts the timer; unmounting clears it so a late
 * timeout never fires setState on a dead component.
 */
export function useFlashStatus(
  durationMs = 1500
): [FlashStatus, (status: Exclude<FlashStatus, "idle">) => void] {
  const [status, setStatus] = useState<FlashStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const flash = useCallback(
    (next: Exclude<FlashStatus, "idle">) => {
      setStatus(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus("idle"), durationMs);
    },
    [durationMs]
  );

  return [status, flash];
}
