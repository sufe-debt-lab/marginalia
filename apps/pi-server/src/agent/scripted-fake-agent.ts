import { randomUUID } from "node:crypto";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type ToolDefinition
} from "@earendil-works/pi-coding-agent";
import { emptyUsage } from "@marginalia/chat-core";
import { AgentSessionRegistry } from "./agent-session-registry.js";
import { PiCodingAgentClient } from "./pi-coding-agent-client.js";
import { ApprovalGateway } from "./approval-gateway.js";
import { FakeAgentClient } from "./fake-agent-client.js";
import type {
  AgentClient,
  AgentPrepareInput,
  AgentRunEvent,
  ApprovalDecision,
  PreparedAgentRun
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
  private readonly workspaceRuntime?: PiCodingAgentClient;

  constructor(options: { workspaceTools?: boolean; sessionDir?: string } = {}) {
    if (!options.workspaceTools) return;
    if (!options.sessionDir)
      throw new Error("Workspace verification requires an isolated session directory");
    const authStorage = AuthStorage.inMemory();
    const registry = new AgentSessionRegistry({
      authStorage,
      modelRegistry: ModelRegistry.inMemory(authStorage),
      sessionManagerFor: (cwd, existing) =>
        existing
          ? SessionManager.open(existing, options.sessionDir, cwd)
          : SessionManager.create(cwd, options.sessionDir),
      createSession: async (config) => {
        const manager = config.sessionManager!;
        const listeners = new Set<(event: AgentRunEvent) => void>();
        const emit = (event: unknown) => {
          for (const listener of listeners) listener(event as AgentRunEvent);
        };
        let controller = new AbortController();
        const message = (content: unknown[]) => ({
          ...assistantMessage(content),
          api: "openai-responses",
          usage: emptyUsage()
        });
        return {
          session: {
            sessionFile: manager.getSessionFile(),
            subscribe(listener: (event: AgentRunEvent) => void) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            dispose() {
              controller.abort();
              listeners.clear();
            },
            async abort() {
              controller.abort();
            },
            async prompt(prompt: string) {
              controller = new AbortController();
              const match = /^workspace-(read|write|edit|bash) ([\s\S]+)$/.exec(prompt);
              if (!match) throw new Error("Expected workspace-<tool> followed by JSON arguments");
              const name = match[1]!;
              const args = JSON.parse(match[2]!);
              const tool = (config.customTools as ToolDefinition[]).find(
                (tool) => tool.name === name
              );
              if (!tool) throw new Error("Tool unavailable in this permission profile");
              const id = randomUUID();
              const assistant = message([{ type: "toolCall", id, name, arguments: args }]);
              manager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
              manager.appendMessage(assistant as never);
              emit({ type: "message_start", message: assistant });
              emit({ type: "message_end", message: assistant });
              emit({ type: "tool_execution_start", toolCallId: id, toolName: name, args });
              let result;
              let isError = false;
              try {
                result = await tool.execute(id, args, controller.signal, undefined, {} as never);
              } catch (error) {
                isError = true;
                result = { content: [{ type: "text", text: (error as Error).message }] };
              }
              const toolResult = {
                role: "toolResult",
                toolCallId: id,
                toolName: name,
                ...result,
                isError,
                timestamp: Date.now()
              };
              manager.appendMessage(toolResult as never);
              emit({ type: "tool_execution_end", toolCallId: id, toolName: name, result, isError });
              const final = message([
                { type: "text", text: isError ? "Tool failed." : "Tool completed." }
              ]);
              manager.appendMessage(final as never);
              emit({ type: "message_start", message: final });
              emit({ type: "message_end", message: final });
            }
          } as unknown as AgentSession
        };
      }
    });
    this.workspaceRuntime = new PiCodingAgentClient(
      registry,
      () => ({ id: "controlled" }),
      new ApprovalGateway()
    );
  }

  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    return (this.workspaceRuntime ?? this.fake).resolveApproval(sessionId, approvalId, decision);
  }

  cancelPending(sessionId: string): number {
    return (this.workspaceRuntime ?? this.fake).cancelPending(sessionId);
  }

  async prepare(input: AgentPrepareInput): Promise<PreparedAgentRun> {
    if (this.workspaceRuntime) return this.workspaceRuntime.prepare(input);
    this.fake.enqueueEvents(bashApprovalScript(input.sessionId));
    const bash = await this.fake.prepare(input);
    this.fake.enqueueEvents(editApprovalScript(input.sessionId));
    const edit = await this.fake.prepare(input);
    this.fake.enqueueEvents(plainScript());
    const plain = await this.fake.prepare(input);

    let started = false;
    return {
      sessionFile: plain.sessionFile,
      release() {},
      start(message, promptOptions) {
        if (started) throw new Error("prepared run already started");
        started = true;
        const prepared = message.includes("approval-bash")
          ? bash
          : message.includes("approval-edit")
            ? edit
            : plain;
        return prepared.start(message, promptOptions);
      }
    };
  }
}
