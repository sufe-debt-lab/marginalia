import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMessagesFromSessionFile } from "../src/agent/session-messages.js";

function writeJsonl(lines: object[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-msg-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

describe("readMessagesFromSessionFile", () => {
  it("returns user and assistant messages in order, ignoring header and non-message entries", () => {
    const file = writeJsonl([
      {
        type: "session",
        version: 3,
        id: "abc",
        cwd: "/tmp",
        timestamp: "2026-05-26T00:00:00.000Z"
      },
      {
        type: "message",
        id: "1",
        parentId: null,
        timestamp: "2026-05-26T00:00:01.000Z",
        message: { role: "user", content: "hello", timestamp: 1748390401000 }
      },
      {
        type: "thinking_level_change",
        id: "2",
        parentId: "1",
        timestamp: "2026-05-26T00:00:02.000Z",
        thinkingLevel: "medium"
      },
      {
        type: "message",
        id: "3",
        parentId: "1",
        timestamp: "2026-05-26T00:00:03.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "world" }],
          api: "anthropic-messages",
          provider: "minimax-cn",
          model: "MiniMax-M2.7",
          usage,
          stopReason: "stop",
          timestamp: 1748390403000
        }
      }
    ]);

    expect(readMessagesFromSessionFile(file)).toEqual([
      { id: "1", message: { role: "user", content: "hello", timestamp: 1748390401000 } },
      {
        id: "3",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "world" }],
          api: "anthropic-messages",
          provider: "minimax-cn",
          model: "MiniMax-M2.7",
          usage,
          stopReason: "stop",
          timestamp: 1748390403000
        }
      }
    ]);
  });

  it("preserves assistant tool calls and tool results for reopened sessions", () => {
    const file = writeJsonl([
      {
        type: "session",
        version: 3,
        id: "abc",
        cwd: "/tmp",
        timestamp: "2026-05-26T00:00:00.000Z"
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-05-26T00:00:01.000Z",
        message: { role: "user", content: "read package", timestamp: 1748390401000 }
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-05-26T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll inspect it." },
            { type: "toolCall", id: "tc1", name: "read", arguments: { path: "package.json" } },
            { type: "toolCall", id: "tc2", name: "bash", arguments: { command: "exit 1" } }
          ],
          api: "anthropic-messages",
          provider: "minimax-cn",
          model: "MiniMax-M2.7",
          usage,
          stopReason: "toolUse",
          timestamp: 1748390402000
        }
      },
      {
        type: "message",
        id: "tr1",
        parentId: "a1",
        timestamp: "2026-05-26T00:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "read",
          content: [{ type: "text", text: '{ "name": "demo" }' }],
          isError: false,
          timestamp: 1748390403000
        }
      },
      {
        type: "message",
        id: "tr2",
        parentId: "tr1",
        timestamp: "2026-05-26T00:00:04.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc2",
          toolName: "bash",
          content: [{ type: "text", text: "exit code 1" }],
          isError: true,
          timestamp: 1748390404000
        }
      }
    ]);

    expect(readMessagesFromSessionFile(file)).toEqual([
      { id: "u1", message: { role: "user", content: "read package", timestamp: 1748390401000 } },
      {
        id: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll inspect it." },
            { type: "toolCall", id: "tc1", name: "read", arguments: { path: "package.json" } },
            { type: "toolCall", id: "tc2", name: "bash", arguments: { command: "exit 1" } }
          ],
          api: "anthropic-messages",
          provider: "minimax-cn",
          model: "MiniMax-M2.7",
          usage,
          stopReason: "toolUse",
          timestamp: 1748390402000
        }
      },
      {
        id: "tr1",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "read",
          content: [{ type: "text", text: '{ "name": "demo" }' }],
          isError: false,
          timestamp: 1748390403000
        }
      },
      {
        id: "tr2",
        message: {
          role: "toolResult",
          toolCallId: "tc2",
          toolName: "bash",
          content: [{ type: "text", text: "exit code 1" }],
          isError: true,
          timestamp: 1748390404000
        }
      }
    ]);
  });

  it("does not project unsupported message roles into UI messages", () => {
    const file = writeJsonl([
      {
        type: "session",
        version: 3,
        id: "abc",
        cwd: "/tmp",
        timestamp: "2026-05-26T00:00:00.000Z"
      },
      {
        type: "message",
        id: "sys1",
        parentId: null,
        timestamp: "2026-05-26T00:00:01.000Z",
        message: { role: "system", content: "ignore me", timestamp: 1748390401000 }
      },
      {
        type: "message",
        id: "u1",
        parentId: "sys1",
        timestamp: "2026-05-26T00:00:02.000Z",
        message: { role: "user", content: "hello", timestamp: 1748390402000 }
      }
    ]);

    expect(readMessagesFromSessionFile(file)).toEqual([
      { id: "u1", message: { role: "user", content: "hello", timestamp: 1748390402000 } }
    ]);
  });

  it("returns [] when the file does not exist", () => {
    expect(readMessagesFromSessionFile("/no/such/path.jsonl")).toEqual([]);
  });
});
