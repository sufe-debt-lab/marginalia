import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toggle } from "./SettingsPrimitives.js";

afterEach(cleanup);

describe("Toggle", () => {
  it("uses the design's 38x21 track with an 18px thumb", () => {
    render(<Toggle on={false} onChange={vi.fn()} label="Resume" />);
    const track = screen.getByRole("switch");
    expect(track).toHaveClass("w-[38px]", "h-[21px]");
    expect(track.querySelector("span")).toHaveClass("h-[18px]", "w-[18px]");
  });

  it("slides the thumb fully across when on", () => {
    render(<Toggle on={true} onChange={vi.fn()} label="Resume" />);
    expect(screen.getByRole("switch").querySelector("span")).toHaveClass("translate-x-[17px]");
  });
});
