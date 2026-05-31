/** A tool call as rendered in the chat stream, shared by desktop UI and pi-server. */
export type UiToolCall = {
  id: string;
  name: string;
  subtitle?: string;
  status: "running" | "done" | "failed";
  result?: string;
};

/** A chat message as rendered in the stream, shared by desktop UI and pi-server. */
export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: UiToolCall[];
};
