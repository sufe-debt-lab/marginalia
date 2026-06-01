import type {
  ChatAssistantMessage,
  ChatEntry,
  ChatToolCall,
  ChatToolExecutionResult,
  ChatToolResult,
  ChatUserMessage
} from "./types.js";

type ChatMessageContent =
  | ChatUserMessage["content"]
  | ChatAssistantMessage["content"]
  | ChatToolResult["content"];

type ToolResultTextSource = ChatToolResult | ChatToolExecutionResult | string | undefined;

/** Flatten pi message content (string or array of text/typed parts) into plain text. */
export function stringifyContent(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function assistantText(message: ChatAssistantMessage): string {
  return stringifyContent(message.content);
}

/** A zeroed token-usage block for synthesizing assistant messages that carry no real usage data. */
export function emptyUsage(): ChatAssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

export function isAssistantToolCall(
  part: ChatAssistantMessage["content"][number]
): part is ChatToolCall {
  return part.type === "toolCall";
}

export function findToolResult(
  entries: readonly ChatEntry[],
  toolCallId: string
): ChatToolResult | undefined {
  return entries.find(
    (entry) => entry.message.role === "toolResult" && entry.message.toolCallId === toolCallId
  )?.message as ChatToolResult | undefined;
}

export function collectToolResults(entries: readonly ChatEntry[]): Map<string, ChatToolResult> {
  const results = new Map<string, ChatToolResult>();
  for (const entry of entries) {
    if (entry.message.role === "toolResult") {
      results.set(entry.message.toolCallId, entry.message);
    }
  }
  return results;
}

/** A compact, human-readable argument pulled from a pi tool call's args. */
export function toolSubtitle(args: ChatToolCall["arguments"]): string | undefined {
  const candidate =
    args.path ?? args.file_path ?? args.filePath ?? args.command ?? args.pattern ?? args.query;
  return typeof candidate === "string" ? candidate : undefined;
}

/** A short, display-ready string for a tool result (truncated to 400 chars). */
export function resultText(result: ToolResultTextSource): string | undefined {
  if (result === undefined) return undefined;
  if (typeof result === "string") return result.slice(0, 400);
  const text = stringifyContent(result.content);
  return text ? text.slice(0, 400) : undefined;
}
