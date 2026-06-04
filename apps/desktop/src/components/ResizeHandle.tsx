import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/cn.js";

interface Props {
  side: "left" | "right";
  getWidth: () => number;
  onWidth: (next: number) => void;
  onCommit?: (next: number) => void;
}

export function ResizeHandle({ side, getWidth, onWidth, onCommit }: Props) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const nextWidth = useRef(0);
  const frame = useRef<number | null>(null);
  const getRef = useRef(getWidth);
  const setRef = useRef(onWidth);
  const commitRef = useRef(onCommit);

  useEffect(() => {
    getRef.current = getWidth;
    setRef.current = onWidth;
    commitRef.current = onCommit;
  }, [getWidth, onWidth, onCommit]);

  const clearGlobals = useCallback(() => {
    document.documentElement.removeAttribute("data-resizing-panels");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  function flush() {
    frame.current = null;
    setRef.current(nextWidth.current);
  }

  const endDrag = useCallback(
    (pointerId?: number, target?: Element) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (pointerId !== undefined && target instanceof HTMLElement) {
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* ignore */
        }
      }
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
        setRef.current(nextWidth.current);
      }
      commitRef.current?.(nextWidth.current);
      clearGlobals();
    },
    [clearGlobals]
  );

  useEffect(() => {
    const cancel = () => endDrag();
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      if (dragging.current) clearGlobals();
    };
  }, [clearGlobals, endDrag]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        startWidth.current = getRef.current();
        nextWidth.current = startWidth.current;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.setAttribute("data-resizing-panels", "true");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - startX.current;
        nextWidth.current = startWidth.current + (side === "right" ? dx : -dx);
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      }}
      onPointerUp={(e) => endDrag(e.pointerId, e.currentTarget)}
      onPointerCancel={() => endDrag()}
      onLostPointerCapture={() => endDrag()}
      className={cn(
        "group absolute top-0 z-30 h-full w-[10px] cursor-col-resize touch-none select-none app-no-drag",
        side === "right" ? "-right-[5px]" : "-left-[5px]"
      )}
    >
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/40 group-active:bg-accent/70" />
    </div>
  );
}
