import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ToolCall } from "@/api/client.js";
import { ToolCard } from "./ToolCard.js";

function card(status: ToolCall["status"]) {
  return { id: "t1", name: "read", subtitle: "docs/spec.md", status };
}

describe("ToolCard", () => {
  it("renders tool name + subtitle", () => {
    const { container } = render(<ToolCard tool={card("running")} />);
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("docs/spec.md")).toBeInTheDocument();
    // running → pulsing ok dot
    expect(container.querySelector(".dot.ok.pulse")).not.toBeNull();
  });

  it("shows an error dot when failed", () => {
    const { container } = render(<ToolCard tool={card("failed")} />);
    expect(container.querySelector(".dot.err")).not.toBeNull();
  });

  it("shows a solid ok dot when done", () => {
    const { container } = render(<ToolCard tool={card("done")} />);
    const dot = container.querySelector(".dot.ok");
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains("pulse")).toBe(false);
  });
});
