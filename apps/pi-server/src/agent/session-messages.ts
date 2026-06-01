import fs from "node:fs";
import {  parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { stringifyContent, toolSubtitle } from "@marginalia/chat-core";
import type { UiMessage, UiToolCall } from "@marginalia/chat-core";

export type { UiMessage, UiToolCall } from "@marginalia/chat-core";

// TODO: 函数中的类型应该遵守 FileEntry / SessionMessageEntry 的类型推导，不应该自己重新定义类型，role 不存在 system ，不要自己定义不存在的类型，包括 @marginalia/chat-core 尽量不要重复定义和 pi 中重复的类型和操作
// UiMessage 应该参考 @earendil-works/pi-tui 中的类型定义，chat 交互也应该和 @earendil-works/pi-tui 保持一致，尽量减少自己重复定义的一些类型或者交互
export function readMessagesFromSessionFile(filePath: string): UiMessage[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const fileEntries = parseSessionEntries(raw);
  const result: UiMessage[] = [];
  const toolCalls = new Map<string, UiToolCall>();
  for (const entry of fileEntries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "message") continue;
    const msgEntry = entry as {
      id?: string;
      message?: {
        role?: string;
        content?: unknown;
        toolCallId?: string;
        toolName?: string;
        isError?: boolean;
      };
    };
    const role = msgEntry.message?.role;
    const id = msgEntry.id;
    if (!id) continue;
    if (role === "toolResult") {
      const toolCallId = msgEntry.message?.toolCallId;
      if (!toolCallId) continue;
      const tool = toolCalls.get(toolCallId);
      if (!tool) continue;
      tool.status = msgEntry.message?.isError ? "failed" : "done";
      tool.result = stringifyContent(msgEntry.message?.content);
      continue;
    }
    if (role !== "user" && role !== "assistant" && role !== "system") continue;

    const message: UiMessage = { id, role, content: stringifyContent(msgEntry.message?.content) };
    if (role === "assistant" && Array.isArray(msgEntry.message?.content)) {
      const calls = msgEntry.message.content
        .filter(
          (part): part is { type: "toolCall"; id: string; name: string; arguments?: unknown } => {
            if (!part || typeof part !== "object") return false;
            const candidate = part as { type?: unknown; id?: unknown; name?: unknown };
            return (
              candidate.type === "toolCall" &&
              typeof candidate.id === "string" &&
              typeof candidate.name === "string"
            );
          }
        )
        .map((part) => {
          const tool = {
            id: part.id,
            name: part.name,
            subtitle: toolSubtitle(part.arguments),
            status: "running"
          } satisfies UiToolCall;
          toolCalls.set(part.id, tool);
          return tool;
        });
      if (calls.length > 0) message.toolCalls = calls;
    }
    result.push(message);
  }
  return result;
}
