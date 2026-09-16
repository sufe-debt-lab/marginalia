import { CredentialStore } from "../src/credentials/store.js";
import { MemoryCredentialAdapter } from "./helpers/memory-credentials.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  formatSkillsForPrompt,
  type AgentSession,
  type Skill
} from "@earendil-works/pi-coding-agent";
import { getModel, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { emptyUsage } from "@marginalia/chat-core";
import { describe, expect, it, vi } from "vitest";
import { PiCodingAgentClient } from "../src/agent/pi-coding-agent-client.js";
import type { AgentRunEvent, AgentSessionEvent } from "../src/agent/agent-client.js";
import type { AgentSessionRegistry, SessionHandle } from "../src/agent/agent-session-registry.js";
import { AgentSessionRegistry as RealAgentSessionRegistry } from "../src/agent/agent-session-registry.js";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";

function fakeSession(events: AgentSessionEvent[]) {
  const listeners: Array<(e: AgentSessionEvent) => void> = [];
  const prompt = vi.fn(async (_message?: string, _promptOptions?: unknown) => {
    for (const event of events) {
      for (const fn of listeners) fn(event);
    }
  });
  return {
    sessionFile: "/tmp/fake.jsonl",
    subscribe(fn: (e: AgentSessionEvent) => void) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    prompt,
    abort: vi.fn(),
    setThinkingLevel: vi.fn(),
    dispose: vi.fn()
  };
}

async function collect(events: AsyncIterable<AgentRunEvent>): Promise<AgentRunEvent[]> {
  const collected: AgentRunEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function emptyRuntimeSkills() {
  return {
    effectiveRevision: "empty-revision",
    loadResult: { skills: [], diagnostics: [] }
  };
}

describe("PiCodingAgentClient", () => {
  it("redacts model error diagnostics before raw events and real pi history persistence", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "credential-pi-"));
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("openai", "synthetic-key");
    const credentialStore = new CredentialStore(new MemoryCredentialAdapter());
    credentialStore.create("provider", "synthetic-key");
    const model = getModel("openai", "gpt-4o");
    const registry = new RealAgentSessionRegistry({
      authStorage,
      modelRegistry: ModelRegistry.inMemory(authStorage),
      sessionManagerFor: () => SessionManager.create(root, path.join(root, "sessions")),
      createSession: async (options) => {
        const result = await createAgentSession({ ...options, tools: [] });
        result.session.setAutoRetryEnabled(false);
        result.session.agent.streamFn = () => {
          const stream = createAssistantMessageEventStream();
          stream.push({
            type: "error",
            reason: "error",
            error: {
              role: "assistant",
              content: [],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: emptyUsage(),
              stopReason: "error",
              errorMessage: "synthetic-key was rejected",
              timestamp: Date.now()
            }
          });
          stream.end();
          return stream;
        };
        return result;
      }
    });
    try {
      const client = new PiCodingAgentClient(
        registry,
        () => model,
        new ApprovalGateway(),
        (message) => credentialStore.redact(message)
      );
      const prepared = await client.prepare({
        sessionId: "s1",
        workspaceRoot: root,
        piProviderId: "openai",
        modelId: model.id,
        runtimeSkills: emptyRuntimeSkills()
      });
      const execution = prepared.start("hello");
      const events = await collect(execution.events);
      await execution.settled;
      expect(JSON.stringify(events)).not.toContain("synthetic-key");
      expect(readFileSync(prepared.sessionFile!, "utf8")).not.toContain("synthetic-key");
      expect(JSON.stringify(events)).toContain("[redacted] was rejected");
    } finally {
      registry.disposeAll();
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("pins the effective skill loader and registry revision for the prepared runtime", async () => {
    const session = fakeSession([]);
    const acquire = vi.fn(async () => ({
      handle: {
        sessionId: "s1",
        session,
        sessionFile: "/tmp/fake.jsonl",
        resourceRevision: "effective-1",
        pin: () => () => {},
        dispose() {}
      },
      release() {}
    }));
    const registry = { acquirePinned: acquire } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    const skill = (name: string, disableModelInvocation: boolean): Skill => ({
      name,
      description: `${name} description`,
      filePath: `/tmp/${name}/SKILL.md`,
      baseDir: `/tmp/${name}`,
      sourceInfo: {
        path: `/tmp/${name}/SKILL.md`,
        source: "local",
        scope: "project",
        origin: "test"
      },
      disableModelInvocation
    });
    const visible = skill("visible", false);
    const explicit = skill("manual", true);

    await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "openai",
      modelId: "m",
      runtimeSkills: {
        effectiveRevision: "effective-1",
        loadResult: {
          skills: [visible, explicit],
          diagnostics: [{ type: "warning", message: "pinned warning", path: visible.filePath }]
        }
      }
    });

    const acquireInput = acquire.mock.calls[0]![0];
    const loader = (
      acquireInput.config as {
        resourceLoader: {
          getSkills(): { skills: Skill[]; diagnostics: unknown[] };
        };
      }
    ).resourceLoader;
    expect(acquireInput.resourceRevision).toBe("effective-1");
    expect(loader.getSkills()).toEqual({
      skills: [visible, explicit],
      diagnostics: [{ type: "warning", message: "pinned warning", path: visible.filePath }]
    });

    const promptFixture = formatSkillsForPrompt(loader.getSkills().skills);
    expect(promptFixture).toContain("<name>visible</name>");
    expect(promptFixture).not.toContain("<name>manual</name>");
  });

  it("rebuilds a cached session when its model or tool profile changes", async () => {
    const created: Array<ReturnType<typeof fakeSession>> = [];
    const createSession = vi.fn(async () => {
      const session = fakeSession([]);
      created.push(session);
      return { session: session as unknown as AgentSession };
    });
    const registry = new RealAgentSessionRegistry({
      authStorage: {} as AuthStorage,
      modelRegistry: {} as ModelRegistry,
      createSession,
      sessionManagerFor: () => SessionManager.inMemory("/workspace")
    });
    const client = new PiCodingAgentClient(
      registry,
      (provider, modelId) => ({ id: `${provider}/${modelId}` }),
      new ApprovalGateway()
    );
    const prepare = (providerId: string, modelId: string, permission: "full" | "readonly") =>
      client.prepare({
        sessionId: "runtime-cache",
        workspaceRoot: "/workspace",
        piProviderId: providerId,
        modelId,
        permission,
        runtimeSkills: emptyRuntimeSkills()
      });

    await prepare("openai", "model-a", "full");
    await prepare("openai", "model-a", "readonly");
    await prepare("openai", "model-b", "readonly");
    await prepare("anthropic", "model-b", "readonly");
    await prepare("anthropic", "model-b", "full");

    expect(createSession).toHaveBeenCalledTimes(5);
    expect(createSession.mock.calls.map(([options]) => options.tools)).toEqual([
      undefined,
      ["read", "grep", "find", "ls"],
      ["read", "grep", "find", "ls"],
      ["read", "grep", "find", "ls"],
      undefined
    ]);
    expect(
      createSession.mock.calls.map(([options]) => (options.model as { id: string }).id)
    ).toEqual([
      "openai/model-a",
      "openai/model-a",
      "openai/model-b",
      "anthropic/model-b",
      "anthropic/model-b"
    ]);
    expect(created.slice(0, -1).every((session) => session.dispose.mock.calls.length === 1)).toBe(
      true
    );
    registry.disposeAll();
  });

  it("assembles the real AgentSession system prompt from pinned visible skills only", async () => {
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "pi-client-skills-"));
    const authStorage = AuthStorage.create(path.join(workspaceRoot, "auth.json"));
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = getModel("openai", "gpt-4.1");
    if (!model) throw new Error("test model missing");
    let createdSession: AgentSession | undefined;
    const registry = new RealAgentSessionRegistry({
      authStorage,
      modelRegistry,
      createSession: async (options) => {
        const result = await createAgentSession(options);
        createdSession = result.session;
        return result;
      },
      sessionManagerFor: () => SessionManager.inMemory(workspaceRoot)
    });
    const skill = (name: string, disableModelInvocation: boolean): Skill => ({
      name,
      description: `${name} description`,
      filePath: `/tmp/${name}/SKILL.md`,
      baseDir: `/tmp/${name}`,
      sourceInfo: {
        path: `/tmp/${name}/SKILL.md`,
        source: "local",
        scope: "project",
        origin: "test"
      },
      disableModelInvocation
    });
    const client = new PiCodingAgentClient(registry, () => model, new ApprovalGateway());

    try {
      await client.prepare({
        sessionId: "real-skills",
        workspaceRoot,
        piProviderId: "openai",
        modelId: "gpt-4.1",
        runtimeSkills: {
          effectiveRevision: "effective-real",
          loadResult: {
            skills: [skill("visible-real", false), skill("manual-real", true)],
            diagnostics: []
          }
        }
      });

      expect(createdSession?.systemPrompt).toContain("<name>visible-real</name>");
      expect(createdSession?.systemPrompt).not.toContain("<name>manual-real</name>");
    } finally {
      registry.disposeAll();
    }
  });

  it("does not prompt during prepare", async () => {
    const session = fakeSession([]);
    const releasePin = vi.fn();
    const acquirePinned = vi.fn(async () => ({
      handle: {
        sessionId: "s1",
        session,
        sessionFile: "/tmp/fake.jsonl",
        pin: () => () => {},
        dispose() {}
      },
      release: releasePin
    }));
    const registry = {
      acquirePinned
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());

    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "openai",
      modelId: "m",
      runtimeSkills: emptyRuntimeSkills()
    });

    expect(session.prompt).not.toHaveBeenCalled();
    expect(acquirePinned).toHaveBeenCalledTimes(1);
    expect(releasePin).not.toHaveBeenCalled();
    const execution = prepared.start("hello");
    expect(session.prompt).toHaveBeenCalledWith("hello", { expandPromptTemplates: false });
    await execution.settled;
    expect(releasePin).toHaveBeenCalledTimes(1);
  });

  it("forces Pi native Skill and template expansion off while preserving prompt options", async () => {
    const session = fakeSession([]);
    const registry = {
      acquirePinned: vi.fn(async () => ({
        handle: {
          sessionId: "s1",
          session,
          sessionFile: "/tmp/fake.jsonl",
          pin: () => () => {},
          dispose() {}
        },
        release() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "openai",
      modelId: "m",
      runtimeSkills: emptyRuntimeSkills()
    });

    const options = { images: [] };
    const execution = prepared.start("/skill:visible", {
      ...options,
      expandPromptTemplates: true
    });

    expect(session.prompt).toHaveBeenCalledWith("/skill:visible", {
      images: [],
      expandPromptTemplates: false
    });
    await execution.settled;
  });

  it("settles after a synchronous prompt failure", async () => {
    const session = fakeSession([]);
    const releasePin = vi.fn();
    session.prompt.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    const registry = {
      acquirePinned: vi.fn(async () => ({
        handle: {
          sessionId: "s1",
          session,
          sessionFile: "/tmp/fake.jsonl",
          pin: () => releasePin,
          dispose() {}
        },
        release: releasePin
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());

    const execution = (
      await client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "openai",
        modelId: "m",
        runtimeSkills: emptyRuntimeSkills()
      })
    ).start("hello");

    await expect(execution.settled).resolves.toBeUndefined();
    await expect(collect(execution.events)).rejects.toThrow("sync boom");
    expect(releasePin).toHaveBeenCalledTimes(1);
  });

  it("rejects a pending event read after an asynchronous prompt failure", async () => {
    let rejectPrompt!: (failure: Error) => void;
    const unsubscribe = vi.fn();
    const session = {
      subscribe: vi.fn(() => unsubscribe),
      prompt: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectPrompt = reject;
          })
      ),
      abort: vi.fn(),
      setThinkingLevel: vi.fn()
    };
    const registry = {
      acquirePinned: vi.fn(async () => ({
        handle: {
          sessionId: "s1",
          session,
          sessionFile: "/tmp/fake.jsonl",
          pin: () => () => {},
          dispose() {}
        },
        release() {}
      }))
    } as unknown as AgentSessionRegistry;
    const gateway = new ApprovalGateway();
    const offApproval = vi.fn();
    const onApproval = vi.spyOn(gateway, "onEvent").mockReturnValue(offApproval);
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), gateway);
    const execution = (
      await client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "openai",
        modelId: "m",
        runtimeSkills: emptyRuntimeSkills()
      })
    ).start("hello");
    const pendingEvent = execution.events[Symbol.asyncIterator]().next();

    rejectPrompt(new Error("async boom"));

    await expect(pendingEvent).rejects.toThrow("async boom");
    await expect(execution.settled).resolves.toBeUndefined();
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(offApproval).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("abort delegates to the prepared session", async () => {
    const session = fakeSession([]);
    const registry = {
      acquirePinned: vi.fn(async () => ({
        handle: {
          sessionId: "s1",
          session,
          sessionFile: "/tmp/fake.jsonl",
          pin: () => () => {},
          dispose() {}
        },
        release() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    const execution = (
      await client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "openai",
        modelId: "m",
        runtimeSkills: emptyRuntimeSkills()
      })
    ).start("hello");

    execution.abort();

    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it("starts a prepared run only once", async () => {
    const session = fakeSession([]);
    const registry = {
      acquirePinned: vi.fn(async () => ({
        handle: {
          sessionId: "s1",
          session,
          sessionFile: "/tmp/fake.jsonl",
          pin: () => () => {},
          dispose() {}
        },
        release() {}
      }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "openai",
      modelId: "m",
      runtimeSkills: emptyRuntimeSkills()
    });

    const execution = prepared.start("first");

    expect(() => prepared.start("second")).toThrow("prepared run already started");
    await execution.settled;
  });

  it("streams pi-native events and resolves sessionFile", async () => {
    const events: AgentSessionEvent[] = [
      { type: "agent_start" } as AgentSessionEvent,
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hi" }
      } as unknown as AgentSessionEvent,
      { type: "message_end", message: { stopReason: "end" } } as unknown as AgentSessionEvent
    ];
    const session = fakeSession(events);
    const handle: SessionHandle = {
      sessionId: "s1",
      workspaceRoot: "/tmp",
      resourceRevision: "empty-revision",
      runtimeRevision: "",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      pin: () => () => {},
      dispose: () => session.dispose()
    };

    const registry = {
      acquirePinned: vi.fn(async () => ({ handle, release() {} }))
    } as unknown as AgentSessionRegistry;

    const client = new PiCodingAgentClient(
      registry,
      () => ({ id: "MiniMax-M2.7" }),
      new ApprovalGateway()
    );
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7",
      runtimeSkills: emptyRuntimeSkills()
    });
    expect(prepared.sessionFile).toBe("/tmp/fake.jsonl");
    const execution = prepared.start("hello");

    const collected: AgentSessionEvent[] = [];
    for await (const e of execution.events) collected.push(e as AgentSessionEvent);
    expect(collected).toEqual(events);
    await execution.settled;
  });

  it("maps readonly permission to a tool allowlist and applies reasoning", async () => {
    const session = fakeSession([
      { type: "message_end", message: { stopReason: "end" } } as unknown as AgentSessionEvent
    ]);
    const handle: SessionHandle = {
      sessionId: "s1",
      workspaceRoot: "/tmp",
      resourceRevision: "empty-revision",
      runtimeRevision: "",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      pin: () => () => {},
      dispose: () => session.dispose()
    };
    const acquirePinned = vi.fn(async () => ({ handle, release() {} }));
    const registry = {
      acquirePinned
    } as unknown as AgentSessionRegistry;

    const client = new PiCodingAgentClient(
      registry,
      () => ({ id: "MiniMax-M2.7" }),
      new ApprovalGateway()
    );
    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7",
      permission: "readonly",
      reasoning: "high",
      runtimeSkills: emptyRuntimeSkills()
    });
    const execution = prepared.start("hello");
    for await (const _e of execution.events) void _e;

    const config = acquirePinned.mock.calls[0][0].config as Record<string, unknown>;
    expect(config.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(config.thinkingLevel).toBe("high");
    expect(session.setThinkingLevel).toHaveBeenCalledWith("high");
  });

  it("releases the reservation when post-acquire reasoning setup fails", async () => {
    const session = fakeSession([]);
    session.setThinkingLevel.mockImplementationOnce(() => {
      throw new Error("settings write failed");
    });
    const release = vi.fn();
    const handle: SessionHandle = {
      sessionId: "s1",
      workspaceRoot: "/tmp",
      resourceRevision: "empty-revision",
      runtimeRevision: "",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      pin: () => () => {},
      dispose: () => session.dispose()
    };
    const registry = {
      acquirePinned: vi.fn(async () => ({ handle, release }))
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());

    await expect(
      client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "openai",
        modelId: "m",
        reasoning: "high",
        runtimeSkills: emptyRuntimeSkills()
      })
    ).rejects.toThrow("settings write failed");

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("leaves tools unset for full permission", async () => {
    const session = fakeSession([
      { type: "message_end", message: { stopReason: "end" } } as unknown as AgentSessionEvent
    ]);
    const handle: SessionHandle = {
      sessionId: "s1",
      workspaceRoot: "/tmp",
      resourceRevision: "empty-revision",
      runtimeRevision: "",
      session: session as any,
      sessionFile: "/tmp/fake.jsonl",
      pin: () => () => {},
      dispose: () => session.dispose()
    };
    const acquirePinned = vi.fn(async () => ({ handle, release() {} }));
    const registry = {
      acquirePinned
    } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => ({ id: "m" }), new ApprovalGateway());
    await client.prepare({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "m",
      permission: "full",
      runtimeSkills: emptyRuntimeSkills()
    });
    const config = acquirePinned.mock.calls[0][0].config as Record<string, unknown>;
    expect(config.tools).toBeUndefined();
  });

  it("throws when the resolver cannot find the model", async () => {
    const registry = { acquire: vi.fn() } as unknown as AgentSessionRegistry;
    const client = new PiCodingAgentClient(registry, () => null, new ApprovalGateway());
    await expect(
      client.prepare({
        sessionId: "s1",
        workspaceRoot: "/tmp",
        piProviderId: "unknown",
        modelId: "nope",
        runtimeSkills: emptyRuntimeSkills()
      })
    ).rejects.toThrow(/unknown\/nope/);
  });
});

function fakeSessionFactory() {
  let subscriber: ((event: unknown) => void) | null = null;
  let finishPrompt: (() => void) | null = null;
  const session = {
    sessionFile: "/tmp/fake-session.jsonl",
    subscribe(fn: (event: unknown) => void) {
      subscriber = fn;
      return () => {};
    },
    prompt() {
      return new Promise<void>((resolve) => {
        finishPrompt = resolve;
      });
    },
    dispose() {}
  };
  return {
    session,
    emit: (event: unknown) => subscriber?.(event),
    finish: () => finishPrompt?.()
  };
}

describe("PiCodingAgentClient approval merge", () => {
  it("merges gateway approval events into the run event stream and resolves via resolveApproval", async () => {
    // Real DefaultResourceLoader.reload() runs inside run(), so workspaceRoot must be a real directory.
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "pi-client-approval-"));
    const fake = fakeSessionFactory();
    const registry = new RealAgentSessionRegistry({
      authStorage: {} as never,
      modelRegistry: {} as never,
      createSession: async () => ({ session: fake.session as never }),
      sessionManagerFor: () => ({}) as never
    });
    const gateway = new ApprovalGateway({ fileExists: () => true });
    const client = new PiCodingAgentClient(registry, () => ({}) as never, gateway);

    const prepared = await client.prepare({
      sessionId: "s1",
      workspaceRoot,
      piProviderId: "openai",
      modelId: "gpt",
      permission: "ask",
      runtimeSkills: emptyRuntimeSkills()
    });
    const execution = prepared.start("hi");
    // Policy was registered for the session by prepare().
    expect(gateway.policyFor("s1")).toEqual({ permission: "ask", workspaceRoot });

    const iterator = execution.events[Symbol.asyncIterator]();
    const decisionPromise = gateway.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect((await iterator.next()).value).toMatchObject({ type: "approval_requested" });

    const approvalId = gateway.pendingIds("s1")[0]!;
    expect(client.resolveApproval("s1", approvalId, { approved: true })).toBe(true);
    await expect(decisionPromise).resolves.toEqual({ approved: true });
    expect((await iterator.next()).value).toMatchObject({
      type: "approval_resolved",
      approved: true
    });

    fake.emit({ type: "message_end", message: {} });
    expect((await iterator.next()).value).toMatchObject({ type: "message_end" });
    fake.finish();
    await execution.settled;
    expect((await iterator.next()).done).toBe(true);
  });
});
