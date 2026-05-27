import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlashMenu } from "./SlashMenu.js";

afterEach(() => cleanup());

describe("SlashMenu", () => {
  it("filters by query and selects with click", async () => {
    const onSelect = vi.fn();
    render(<SlashMenu query="cle" onSelect={onSelect} onClose={() => {}} />);
    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.queryByText("/help")).toBeNull();
    await userEvent.click(screen.getByText("/clear"));
    expect(onSelect).toHaveBeenCalledWith("clear");
  });
});
