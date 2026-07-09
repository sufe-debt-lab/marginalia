import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewEdit, previewWrite } from "../src/agent/diff-preview.js";

function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "diff-preview-"));
}

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
