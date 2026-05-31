import fs from "node:fs";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: UiToolCall[];
};

export type UiToolCall = {
  id: string;
  name: string;
  subtitle?: string;
  status: "running" | "done" | "failed";
  result?: string;
};

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      const candidate = part as { type?: string; text?: unknown };
      if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
      return "";
    })
    .join("");
}

function toolSubtitle(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  const candidate = a.path ?? a.file_path ?? a.filePath ?? a.command ?? a.pattern ?? a.query;
  return typeof candidate === "string" ? candidate : undefined;
}

export function readMessagesFromSessionFile(filePath: string): UiMessage[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const fileEntries = parseSessionEntries(raw);
  const result: UiMessage[] = [];
  const toolCalls = new Map<string, UiToolCall>();
  for (const entry of fileEntries) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: string }).type !== "message") continue;
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
        .filter((part): part is { type: "toolCall"; id: string; name: string; arguments?: unknown } => {
          if (!part || typeof part !== "object") return false;
          const candidate = part as { type?: unknown; id?: unknown; name?: unknown };
          return (
            candidate.type === "toolCall" &&
            typeof candidate.id === "string" &&
            typeof candidate.name === "string"
          );
        })
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
