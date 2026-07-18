import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock.js";

describe("CodeBlock", () => {
  it("shows the language label and copies the raw code", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code={'print("hi")'} language="python" />);
    expect(screen.getByText("python")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy|复制/i }));
    expect(writeText).toHaveBeenCalledWith('print("hi")');
    expect(await screen.findByText(/copied|已复制/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("shows a failure label instead of crashing when the clipboard is unavailable", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code="x" language="ts" />);
    await userEvent.click(screen.getByRole("button", { name: /copy|复制/i }));
    expect(await screen.findByText(/copy failed|复制失败/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
