import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatAssistantMessage, ChatEntry, ChatToolResult } from "@marginalia/chat-core";
import { areMessageItemPropsEqual, MessageItem } from "./MessageItem.js";

afterEach(() => cleanup());

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

describe("MessageItem", () => {
  it("renders user content right-aligned in a pill", () => {
    render(
      <MessageItem entry={{ id: "1", message: { role: "user", content: "hello", timestamp: 1 } }} />
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders assistant content as markdown with label", () => {
    const entry: ChatEntry = {
      id: "2",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "**bold**" }],
        api: "anthropic-messages",
        provider: "minimax-cn",
        model: "MiniMax-M2.7",
        usage,
        stopReason: "stop",
        timestamp: 2
      }
    };
    render(<MessageItem entry={entry} />);
    expect(screen.getByText("assistant")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("renders assistant tool calls in content order with matched tool results", () => {
    const result: ChatToolResult = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "read",
      content: [{ type: "text", text: "package content" }],
      isError: false,
      timestamp: 3
    };
    render(
      <MessageItem
        entry={{
          id: "a1",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "before" },
              { type: "toolCall", id: "tc1", name: "read", arguments: { path: "package.json" } },
              { type: "text", text: "after" }
            ],
            api: "anthropic-messages",
            provider: "minimax-cn",
            model: "MiniMax-M2.7",
            usage,
            stopReason: "toolUse",
            timestamp: 2
          }
        }}
        toolResultsByCallId={new Map([["tc1", result]])}
      />
    );

    expect(screen.getByText("before")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("package content")).toBeInTheDocument();
    expect(screen.getByText("after")).toBeInTheDocument();
  });
});

function assistantEntry(content: ChatAssistantMessage["content"], id = "m1"): ChatEntry {
  return {
    id,
    message: {
      role: "assistant",
      content,
      api: "marginalia-stream",
      provider: "p",
      model: "m",
      usage,
      stopReason: "stop",
      timestamp: 1
    }
  };
}

describe("areMessageItemPropsEqual", () => {
  const entry = assistantEntry([
    { type: "toolCall", id: "t1", name: "bash", arguments: { command: "x" } }
  ]);
  const base = { entry, model: "m", streaming: false };

  it("skips re-render when only another message's progress changes", () => {
    const prev = { ...base, toolProgressByCallId: new Map([["other", "a"]]) };
    const next = { ...base, toolProgressByCallId: new Map([["other", "ab"]]) };
    expect(areMessageItemPropsEqual(prev, next)).toBe(true);
  });

  it("re-renders when its own tool call's progress changes", () => {
    const prev = { ...base, toolProgressByCallId: new Map([["t1", "a"]]) };
    const next = { ...base, toolProgressByCallId: new Map([["t1", "ab"]]) };
    expect(areMessageItemPropsEqual(prev, next)).toBe(false);
  });

  it("treats fresh map identities with identical relevant values as equal", () => {
    const approval = {
      id: "ap-1",
      toolCallId: "t1",
      toolName: "bash",
      kind: "command" as const,
      status: "pending" as const,
      payload: { kind: "command" as const, command: "x", cwd: "/ws" }
    };
    const prev = { ...base, approvalsByToolCallId: new Map([["t1", approval]]) };
    const next = { ...base, approvalsByToolCallId: new Map([["t1", approval]]) };
    expect(areMessageItemPropsEqual(prev, next)).toBe(true);
  });

  it("always re-renders when the entry object itself changes", () => {
    const next = {
      ...base,
      entry: assistantEntry([{ type: "toolCall", id: "t1", name: "bash", arguments: {} }])
    };
    expect(areMessageItemPropsEqual(base, next)).toBe(false);
  });
});

describe("MessageItem hover actions", () => {
  const textEntry = assistantEntry([{ type: "text", text: "# 报告 Summary\n\n正文" }], "abcdef12");

  it("keeps the action bar reachable for keyboard focus", () => {
    render(<MessageItem entry={textEntry} />);
    const bar = screen
      .getByRole("button", { name: /copy full text|复制全文/i })
      .closest("div.absolute");
    expect(bar?.className).toMatch(/focus-within:opacity-100/);
  });

  it("exports with the heading-slug default name, same as save-to-workspace", async () => {
    const saveTextFile = vi.fn(async () => ({ saved: true, path: "/tmp/x" }));
    vi.stubGlobal("window", Object.assign(window, { marginalia: { saveTextFile } }));
    render(<MessageItem entry={textEntry} />);
    await userEvent.click(screen.getByRole("button", { name: /export|导出/i }));
    expect(saveTextFile).toHaveBeenCalledWith({
      defaultName: "报告-summary.md",
      content: "# 报告 Summary\n\n正文"
    });
  });

  it("falls back to a localized default name when there is no heading", async () => {
    const saveTextFile = vi.fn(async (_input: { defaultName: string; content: string }) => ({
      saved: true,
      path: "/tmp/x"
    }));
    vi.stubGlobal("window", Object.assign(window, { marginalia: { saveTextFile } }));
    render(<MessageItem entry={assistantEntry([{ type: "text", text: "plain" }], "zz")} />);
    await userEvent.click(screen.getByRole("button", { name: /export|导出/i }));
    expect(saveTextFile.mock.calls[0]![0].defaultName).toMatch(/^marginalia-(notes|笔记)\.md$/);
  });
});
