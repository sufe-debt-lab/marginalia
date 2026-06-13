import { useEffect, useState } from "react";

/** Floating listbox surface above the composer — shared by the mention & slash menus. */
export const COMPOSER_MENU_CLS =
  "absolute bottom-full left-0 mb-2 rounded-card border border-border bg-popover p-1.5 text-popover-foreground shadow-pop motion-menu";

/**
 * Keyboard navigation for the composer's inline listbox menus:
 * Escape closes, ArrowUp/ArrowDown move the highlight, Enter picks.
 * `resetKey` re-anchors the highlight to the first item when it changes
 * (e.g. the filter query or the suggestion list).
 */
export function useMenuNav<T>(
  items: readonly T[],
  onPick: (item: T) => void,
  onClose: () => void,
  resetKey: unknown
) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [resetKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((current) => Math.min(current + 1, items.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((current) => Math.max(current - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        const active = items[activeIndex];
        if (!active) return;
        e.preventDefault();
        onPick(active);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, items, onClose, onPick]);

  return { activeIndex, setActiveIndex };
}
