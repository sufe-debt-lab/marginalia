import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageStream } from "./MessageStream.js";

describe("MessageStream", () => {
  it("renders empty state when no messages", () => {
    render(<MessageStream messages={[]} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/no messages/i)).toBeInTheDocument();
  });

  it("renders messages", () => {
    render(
      <MessageStream
        messages={[
          { id: "1", role: "user", content: "hi" },
          { id: "2", role: "assistant", content: "yo" }
        ]}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("yo")).toBeInTheDocument();
  });

  it("scrolls to the bottom as the last message streams in", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const { rerender } = render(
      <MessageStream
        messages={[{ id: "1", role: "assistant", content: "a" }]}
        error={null}
        onRetry={() => {}}
        streaming
      />
    );
    const before = scrollSpy.mock.calls.length;
    rerender(
      <MessageStream
        messages={[{ id: "1", role: "assistant", content: "ab cd" }]}
        error={null}
        onRetry={() => {}}
        streaming
      />
    );
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("renders error row + retry button", async () => {
    const onRetry = vi.fn();
    render(
      <MessageStream
        messages={[{ id: "1", role: "user", content: "hi" }]}
        error="boom"
        onRetry={onRetry}
      />
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.getByText("run_failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
