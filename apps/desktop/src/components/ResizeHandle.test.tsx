import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle.js";

afterEach(() => cleanup());

describe("ResizeHandle", () => {
  it("renders a separator role", () => {
    render(
      <ResizeHandle side="right" getWidth={() => 240} onWidth={() => {}} />
    );
    const sep = screen.getByRole("separator");
    expect(sep).toBeInTheDocument();
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
  });

  it("calls onWidth via rAF on pointer move with delta (side=right)", async () => {
    const onWidth = vi.fn();
    const getWidth = () => 240;
    render(<ResizeHandle side="right" getWidth={getWidth} onWidth={onWidth} />);
    const sep = screen.getByRole("separator");

    fireEvent.pointerDown(sep, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 150, pointerId: 1 });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    expect(onWidth).toHaveBeenCalledWith(290);

    fireEvent.pointerUp(sep, { clientX: 150, pointerId: 1 });
  });

  it("inverts delta for side=left and calls onCommit on pointer up", async () => {
    const onWidth = vi.fn();
    const onCommit = vi.fn();
    render(
      <ResizeHandle
        side="left"
        getWidth={() => 300}
        onWidth={onWidth}
        onCommit={onCommit}
      />
    );
    const sep = screen.getByRole("separator");

    fireEvent.pointerDown(sep, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 150, pointerId: 1 });
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    // delta = -50, side=left inverts → 300 - (-50) = 350
    expect(onWidth).toHaveBeenCalledWith(350);

    fireEvent.pointerUp(sep, { clientX: 150, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(350);
  });
});
