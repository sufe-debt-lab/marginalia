import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock.js";

describe("ThinkingBlock", () => {
  it("shows live label and text while streaming", () => {
    render(<ThinkingBlock text="pondering deeply" streaming />);
    expect(screen.getByText(/thinking|思考中/i)).toBeInTheDocument();
    expect(screen.getByText("pondering deeply")).toBeInTheDocument();
  });

  it("collapses when done and expands on click", async () => {
    render(<ThinkingBlock text="hidden reasoning" streaming={false} />);
    expect(screen.queryByText("hidden reasoning")).not.toBeInTheDocument();
    expect(screen.getByText(/thought|已思考/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("hidden reasoning")).toBeInTheDocument();
  });
});
