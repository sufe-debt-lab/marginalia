import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { extractHeadings, MessageToc } from "./MessageToc.js";

describe("extractHeadings", () => {
  it("collects heading levels, text and line numbers, skipping code fences", () => {
    const md = ["# A", "", "```", "# not a heading", "```", "## B", "text", "### C"].join("\n");
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: "A", line: 1 },
      { level: 2, text: "B", line: 6 },
      { level: 3, text: "C", line: 8 }
    ]);
  });
});

describe("MessageToc", () => {
  it("scrolls to the heading anchor on click", async () => {
    const target = document.createElement("h2");
    target.id = "m1-h-6";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    render(<MessageToc prefix="m1" items={[{ level: 2, text: "B", line: 6 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "B" }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });
});
