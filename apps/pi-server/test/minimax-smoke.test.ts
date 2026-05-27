import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";

const KEY = process.env.MINIMAX_CN_API_KEY;

describe.runIf(Boolean(KEY))("minimax-cn live smoke", () => {
  it(
    "streams at least one text_delta and ends cleanly",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-smoke-"));
      const authStorage = AuthStorage.create(path.join(tmpDir, "auth.json"));
      authStorage.setRuntimeApiKey("minimax-cn", KEY!);
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const model = getModel("minimax-cn", "MiniMax-M2.7");
      if (!model) throw new Error("MiniMax-M2.7 missing from pi-ai built-ins");

      const { session } = await createAgentSession({
        cwd: tmpDir,
        agentDir: tmpDir,
        model,
        authStorage,
        modelRegistry,
        sessionManager: SessionManager.inMemory(tmpDir),
        tools: []
      });

      const deltas: string[] = [];
      let ended = false;

      const unsubscribe = session.subscribe((event: any) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent?.type === "text_delta" &&
          event.assistantMessageEvent.delta
        ) {
          deltas.push(event.assistantMessageEvent.delta);
        }
        if (event.type === "message_end" && event.message?.role === "assistant") ended = true;
      });

      try {
        await session.prompt("Say hi in 5 words.");
      } finally {
        unsubscribe?.();
        session.dispose();
      }

      expect(deltas.join("").length).toBeGreaterThan(0);
      expect(ended).toBe(true);
    },
    120_000
  );
});
