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
          stopReason: "stop",
          timestamp: 1748390403000
        }
      }
    ]);

    expect(readMessagesFromSessionFile(file)).toEqual([
      { id: "1", role: "user", content: "hello" },
      { id: "3", role: "assistant", content: "world" }
    ]);
  });

  it("preserves assistant tool calls and matching tool results for reopened sessions", () => {
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
            { type: "toolCall", id: "tc1", name: "read", arguments: { path: "package.json" } }
          ],
          api: "anthropic-messages",
          provider: "minimax-cn",
          model: "MiniMax-M2.7",
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
      }
    ]);

    expect(readMessagesFromSessionFile(file)).toEqual([
      { id: "u1", role: "user", content: "read package" },
      {
        id: "a1",
        role: "assistant",
        content: "I'll inspect it.",
        toolCalls: [
          {
            id: "tc1",
            name: "read",
            subtitle: "package.json",
            status: "done",
            result: '{ "name": "demo" }'
          }
        ]
      }
    ]);
  });

  it("returns [] when the file does not exist", () => {
    expect(readMessagesFromSessionFile("/no/such/path.jsonl")).toEqual([]);
  });
});
