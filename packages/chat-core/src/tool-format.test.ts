import { describe, expect, it } from "vitest";
import type {
  ChatAssistantMessage,
  ChatEntry,
  ChatToolCall,
  ChatToolExecutionResult,
  ChatToolResult,
  ChatUserMessage
} from "./types.js";
import {
  assistantText,
  collectToolResults,
  findToolResult,
  fullResultText,
  resultText,
  stringifyContent,
  toolSubtitle,
  toolSummary
} from "./tool-format.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

describe("stringifyContent", () => {
  it("returns strings as-is", () => {
    const content: ChatUserMessage["content"] = "hello";
    expect(stringifyContent(content)).toBe("hello");
  });

  it("joins text parts and ignores non-text parts", () => {
    const content: ChatAssistantMessage["content"] = [
      { type: "text", text: "a" },
      { type: "toolCall", id: "t", name: "read", arguments: {} },
      { type: "text", text: "b" }
    ];
    expect(stringifyContent(content)).toBe("ab");
  });
});

describe("assistantText", () => {
  it("extracts only text content from a pi assistant message", () => {
    expect(
      assistantText({
        role: "assistant",
        content: [
          { type: "text", text: "before " },
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } },
          { type: "text", text: "after" }
        ],
        api: "anthropic-messages",
        provider: "minimax-cn",
        model: "MiniMax-M2.7",
        usage,
        stopReason: "toolUse",
        timestamp: 1
      })
    ).toBe("before after");
  });
});

describe("tool result matching", () => {
  const done: ChatToolResult = {
    role: "toolResult",
    toolCallId: "tc1",
    toolName: "read",
    content: [{ type: "text", text: "done" }],
    isError: false,
    timestamp: 2
  };
  const failed: ChatToolResult = {
    role: "toolResult",
    toolCallId: "tc2",
    toolName: "bash",
    content: [{ type: "text", text: "failed" }],
    isError: true,
    timestamp: 3
  };
  const entries: ChatEntry[] = [
    { id: "tr1", message: done },
    { id: "tr2", message: failed }
  ];

  it("finds a matching toolResult by toolCallId", () => {
    expect(findToolResult(entries, "tc1")).toBe(done);
    expect(findToolResult(entries, "missing")).toBeUndefined();
  });

  it("collects the latest toolResult for each tool call", () => {
    expect(collectToolResults(entries).get("tc2")).toBe(failed);
  });
});

describe("toolSubtitle", () => {
  it("prefers path-like fields", () => {
    expect(toolSubtitle({ path: "a.ts" })).toBe("a.ts");
    expect(toolSubtitle({ command: "ls" })).toBe("ls");
  });

  it("returns undefined when no recognised field is present", () => {
    const args: ChatToolCall["arguments"] = { other: 1 };
    expect(toolSubtitle(args)).toBeUndefined();
  });
});

describe("resultText", () => {
  it("truncates long strings to 400 chars", () => {
    expect(resultText("x".repeat(500))).toHaveLength(400);
  });

  it("extracts text from a content array", () => {
    const result: ChatToolExecutionResult = {
      content: [{ type: "text", text: "done" }],
      details: undefined
    };
    expect(resultText(result)).toBe("done");
  });

  it("extracts text from a pi toolResult message", () => {
    expect(
      resultText({
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "read",
        content: [{ type: "text", text: "done" }],
        isError: false,
        timestamp: 1
      })
    ).toBe("done");
  });

  it("returns undefined for empty input", () => {
    expect(resultText(undefined)).toBeUndefined();
  });
});

describe("toolSummary", () => {
  it("summarises per tool name", () => {
    expect(
      toolSummary({
        type: "toolCall",
        id: "1",
        name: "bash",
        arguments: { command: "python x.py" }
      })
    ).toEqual({ title: "bash", detail: "python x.py" });
    expect(
      toolSummary({ type: "toolCall", id: "2", name: "read", arguments: { path: "a.md" } })
    ).toEqual({ title: "read", detail: "a.md" });
    expect(
      toolSummary({ type: "toolCall", id: "3", name: "grep", arguments: { pattern: "foo" } })
    ).toEqual({ title: "grep", detail: "foo" });
  });

  it("falls back to toolSubtitle for unknown tools", () => {
    expect(
      toolSummary({ type: "toolCall", id: "4", name: "mystery", arguments: { query: "q" } })
    ).toEqual({ title: "mystery", detail: "q" });
    expect(toolSummary({ type: "toolCall", id: "5", name: "mystery", arguments: {} })).toEqual({
      title: "mystery",
      detail: undefined
    });
  });
});

describe("fullResultText", () => {
  it("does not truncate long outputs", () => {
    const long = "x".repeat(1000);
    expect(fullResultText(long)).toHaveLength(1000);
    expect(
      fullResultText({
        role: "toolResult",
        toolCallId: "t",
        toolName: "bash",
        content: [{ type: "text", text: long }],
        isError: false,
        timestamp: 1
      })
    ).toHaveLength(1000);
  });
});
