import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentMessage } from "../src/agent/agent-message.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildAgentMessage", () => {
  it("returns the user text unchanged without skills or attachments", async () => {
    await expect(
      buildAgentMessage({ workspaceRoot: "/tmp", text: "hello", contextFiles: [] })
    ).resolves.toBe("hello");
  });

  it("places skill blocks first and the deduplicated attachment envelope last", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-message-"));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, "note.md"), "# Note\ncontext", "utf8");

    const message = await buildAgentMessage({
      workspaceRoot: root,
      text: "summarize",
      contextFiles: [" note.md ", "note.md"],
      skillBlocks: ["<skill>first</skill>", "<skill>second</skill>"]
    });

    expect(message).toBe(
      '<skill>first</skill>\n\n<skill>second</skill>\n\nsummarize\n\n<attached_files>\n<attached_file path="note.md" mime="text/markdown">\n# Note\ncontext\n</attached_file>\n</attached_files>'
    );
  });

  it("keeps unreadable attachments as escaped error entries", async () => {
    const message = await buildAgentMessage({
      workspaceRoot: "/tmp",
      text: "inspect",
      contextFiles: ['missing<&".md']
    });

    expect(message).toContain('path="missing&lt;&amp;&quot;.md"');
    expect(message).toContain('error="');
    expect(message.endsWith("</attached_files>")).toBe(true);
  });

  it("encodes attachment attribute line breaks without changing the generated grammar", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-message-"));
    tempDirs.push(root);
    const fileName = "line\nbreak.md";
    fs.writeFileSync(path.join(root, fileName), "context", "utf8");

    const message = await buildAgentMessage({
      workspaceRoot: root,
      text: "inspect",
      contextFiles: [fileName]
    });

    expect(message).toContain(
      '<attached_file path="line&#10;break.md" mime="text/markdown">\ncontext\n</attached_file>'
    );
    expect(message).not.toContain('path="line\nbreak.md"');
  });
});
