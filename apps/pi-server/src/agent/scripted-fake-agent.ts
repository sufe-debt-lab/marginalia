import { FakeAgentClient } from "./fake-agent-client.js";
import type {
  AgentClient,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  ApprovalDecision
} from "./agent-client.js";

function assistantMessage(content: unknown[]): Record<string, unknown> {
  return {
    role: "assistant",
    content,
    api: "scripted",
    provider: "fake",
    model: "fake",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
}

function bashApprovalScript(sessionId: string): AgentRunEvent[] {
  const toolCall = {
    type: "toolCall",
    id: "fake-t1",
    name: "bash",
    arguments: { command: "python analyze.py 债务数据/汇总.csv" }
  };
  const finalText = { type: "text", text: "分析完成：共 251 份文档。" };
  return [
    { type: "message_start", message: assistantMessage([toolCall]) },
    {
      type: "tool_execution_start",
      toolCallId: "fake-t1",
      toolName: "bash",
      args: toolCall.arguments
    },
    {
      type: "approval_requested",
      approvalId: "fake-ap-1",
      sessionId,
      toolCallId: "fake-t1",
      toolName: "bash",
      payload: {
        kind: "command",
        command: "python analyze.py 债务数据/汇总.csv",
        cwd: "/tmp/fake-ws"
      }
    },
    {
      type: "tool_execution_end",
      toolCallId: "fake-t1",
      toolName: "bash",
      result: "rows: 251",
      isError: false
    },
    // NB: keeps the toolCall content block alongside the closing text. useMessages'
    // replaceAssistant() fully overwrites the bubble's content on message_end, so a
    // text-only final message here would silently erase the already-rendered
    // ToolCard/ApprovalCard from the transcript.
    { type: "message_end", message: assistantMessage([toolCall, finalText]) }
  ] as unknown as AgentRunEvent[];
}

function editApprovalScript(sessionId: string): AgentRunEvent[] {
  const patch = [
    "--- a/摘要.md",
    "+++ b/摘要.md",
    "@@ -1,2 +1,2 @@",
    " # 摘要",
    "-旧结论",
    "+新结论：专项债覆盖率提升"
  ].join("\n");
  const toolCall = {
    type: "toolCall",
    id: "fake-t2",
    name: "edit",
    arguments: { path: "摘要.md" }
  };
  const finalText = { type: "text", text: "已更新摘要。" };
  return [
    { type: "message_start", message: assistantMessage([toolCall]) },
    {
      type: "tool_execution_start",
      toolCallId: "fake-t2",
      toolName: "edit",
      args: toolCall.arguments
    },
    {
      type: "approval_requested",
      approvalId: "fake-ap-2",
      sessionId,
      toolCallId: "fake-t2",
      toolName: "edit",
      payload: {
        kind: "file_edit",
        path: "摘要.md",
        mode: "edit",
        patch,
        additions: 1,
        deletions: 1,
        exact: true
      }
    },
    {
      type: "tool_execution_end",
      toolCallId: "fake-t2",
      toolName: "edit",
      result: "ok",
      isError: false
    },
    // See bashApprovalScript's note: keep the toolCall block in the final message.
    { type: "message_end", message: assistantMessage([toolCall, finalText]) }
  ] as unknown as AgentRunEvent[];
}

function plainScript(): AgentRunEvent[] {
  return [
    { type: "message_start", message: assistantMessage([]) },
    {
      type: "message_update",
      message: assistantMessage([]),
      assistantMessageEvent: { type: "text_delta", delta: "好的，这是一段示例回复。" }
    },
    {
      type: "message_end",
      message: assistantMessage([{ type: "text", text: "好的，这是一段示例回复。" }])
    }
  ] as unknown as AgentRunEvent[];
}

/** Deterministic scripted agent for screenshots/dev (MARGINALIA_FAKE_AGENT=1). */
export class ScriptedFakeAgentClient implements AgentClient {
  private readonly fake = new FakeAgentClient();

  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    return this.fake.resolveApproval(sessionId, approvalId, decision);
  }

  cancelPending(sessionId: string): number {
    return this.fake.cancelPending(sessionId);
  }

  run(input: AgentRunInput): Promise<AgentRunResult> {
    const script = input.message.includes("approval-bash")
      ? bashApprovalScript(input.sessionId)
      : input.message.includes("approval-edit")
        ? editApprovalScript(input.sessionId)
        : plainScript();
    this.fake.enqueueEvents(script);
    return this.fake.run(input);
  }
}
