import { existsSync, readFileSync } from "node:fs";
import { createTwoFilesPatch } from "diff";
import { resolveWorkspacePath } from "../files/path-sandbox.js";

export type DiffPreview = {
  patch: string;
  additions: number;
  deletions: number;
  exact: boolean;
  error?: string;
};

function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function buildPatch(
  relPath: string,
  oldContent: string,
  newContent: string,
  exact: boolean
): DiffPreview {
  const patch = createTwoFilesPatch(relPath, relPath, oldContent, newContent, "", "", {
    context: 3
  });
  return { patch, ...countChanges(patch), exact };
}

function failed(error: string): DiffPreview {
  return { patch: "", additions: 0, deletions: 0, exact: false, error };
}

export function previewWrite(
  workspaceRoot: string,
  relPath: string,
  newContent: string
): DiffPreview {
  try {
    const absolute = resolveWorkspacePath(workspaceRoot, relPath);
    const oldContent = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    return buildPatch(relPath, oldContent, newContent, true);
  } catch (error) {
    return failed((error as Error).message);
  }
}

export type EditOp = { oldText: string; newText: string };

export function previewEdit(
  workspaceRoot: string,
  relPath: string,
  oldText: string,
  newText: string
): DiffPreview {
  return previewEdits(workspaceRoot, relPath, [{ oldText, newText }]);
}

/**
 * Preview one or more exact-text replacements. pi's edit tool accepts both the
 * legacy `{ oldText, newText }` shape and the current `{ edits: [...] }` array;
 * this applies each edit in sequence against the on-disk content. If every
 * oldText matches we produce an exact diff; if any does not, the preview is
 * marked approximate (pi's own fuzzy matcher isn't exported, so we can't mirror
 * it) but we still diff whatever we could apply.
 */
export function previewEdits(
  workspaceRoot: string,
  relPath: string,
  edits: readonly EditOp[]
): DiffPreview {
  try {
    const absolute = resolveWorkspacePath(workspaceRoot, relPath);
    const content = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    let next = content;
    let exact = edits.length > 0;
    for (const edit of edits) {
      const index = edit.oldText ? next.indexOf(edit.oldText) : -1;
      if (index >= 0) {
        next = next.slice(0, index) + edit.newText + next.slice(index + edit.oldText.length);
      } else {
        exact = false;
      }
    }
    if (exact) return buildPatch(relPath, content, next, true);
    // Fall back to an approximate diff. If at least one edit applied, show the
    // partial result; otherwise show the first edit's old→new intent.
    if (next !== content) return { ...buildPatch(relPath, content, next, false), exact: false };
    const first = edits[0] ?? { oldText: "", newText: "" };
    return { ...buildPatch(relPath, first.oldText, first.newText, false), exact: false };
  } catch (error) {
    return failed((error as Error).message);
  }
}
