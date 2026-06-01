import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  Message as PiMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage
} from "@earendil-works/pi-ai";

export type PiMessageCore = PiMessage;

export type ChatEntry = {
  id: string;
  message: PiMessageCore;
};

export type ChatUserMessage = UserMessage;
export type ChatAssistantMessage = AssistantMessage;
export type ChatToolCall = ToolCall;
export type ChatToolResult = ToolResultMessage;
export type ChatToolExecutionResult = AgentToolResult<unknown>;
