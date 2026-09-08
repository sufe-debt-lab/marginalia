import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewEdit, previewEdits, previewWrite } from "../src/agent/diff-preview.js";

function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "diff-preview-"));
}

describe("previewEdits", () => {
  it("applies multiple edits in sequence for an exact diff", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "# 旧标题\n\n正文一\n正文二\n");
    const preview = previewEdits(root, "a.md", [
      { oldText: "# 旧标题", newText: "# 新标题" },
      { oldText: "正文二", newText: "结论" }
    ]);
    expect(preview.exact).toBe(true);
    expect(preview.patch).toContain("+# 新标题");
    expect(preview.patch).toContain("+结论");
    expect(preview.additions).toBe(2);
    expect(preview.deletions).toBe(2);
  });

  it("handles a single-element edits array like the legacy shape", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "# 旧标题\n");
    const preview = previewEdits(root, "a.md", [{ oldText: "# 旧标题", newText: "# 验证通过" }]);
    expect(preview.exact).toBe(true);
    expect(preview.patch).toContain("+# 验证通过");
  });

  it("marks the preview approximate when an edit does not match", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "alpha\n");
    const preview = previewEdits(root, "a.md", [{ oldText: "not-there", newText: "x" }]);
    expect(preview.exact).toBe(false);
  });
});

describe("previewWrite", () => {
  it("diffs against the existing file with Chinese content", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "报告.md"), "第一行\n第二行\n");
    const preview = previewWrite(root, "报告.md", "第一行\n改写的第二行\n");
    expect(preview.exact).toBe(true);
    expect(preview.additions).toBe(1);
    expect(preview.deletions).toBe(1);
    expect(preview.patch).toContain("+改写的第二行");
  });

  it("treats a missing file as new-file diff", () => {
    const root = tempWorkspace();
    const preview = previewWrite(root, "new.md", "hello\n");
    expect(preview.exact).toBe(true);
    expect(preview.additions).toBe(1);
    expect(preview.deletions).toBe(0);
  });

  it("reports an error for a path escaping the workspace", () => {
    const root = tempWorkspace();
    const preview = previewWrite(root, "../outside.md", "x");
    expect(preview.error).toBeTruthy();
    expect(preview.patch).toBe("");
  });
});

describe("previewEdit", () => {
  it("produces an exact diff when oldText matches", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "alpha\nbeta\ngamma\n");
    const preview = previewEdit(root, "a.md", "beta", "BETA");
    expect(preview.exact).toBe(true);
    expect(preview.patch).toContain("-beta");
    expect(preview.patch).toContain("+BETA");
  });

  it("falls back to oldText→newText approximate diff when no exact match", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "alpha\n");
    const preview = previewEdit(root, "a.md", "not-in-file", "replacement");
    expect(preview.exact).toBe(false);
    expect(preview.patch).toContain("-not-in-file");
    expect(preview.patch).toContain("+replacement");
  });

  it("handles an empty file", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "empty.md"), "");
    const preview = previewEdit(root, "empty.md", "x", "y");
    expect(preview.exact).toBe(false);
  });
});
