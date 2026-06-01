import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageItem } from "./MessageItem.js";

describe("MessageItem", () => {
  it("renders user content right-aligned in a pill", () => {
    render(<MessageItem message={{ id: "1", role: "user", content: "hello" }} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders assistant content as markdown with label", () => {
    render(<MessageItem message={{ id: "2", role: "assistant", content: "**bold**" }} />);
    expect(screen.getByText("assistant")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});
