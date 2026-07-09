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

export function previewEdit(
  workspaceRoot: string,
  relPath: string,
  oldText: string,
  newText: string
): DiffPreview {
  try {
    const absolute = resolveWorkspacePath(workspaceRoot, relPath);
    const content = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    const index = content.indexOf(oldText);
    if (oldText && index >= 0) {
      const next = content.slice(0, index) + newText + content.slice(index + oldText.length);
      return buildPatch(relPath, content, next, true);
    }
    // Approximate preview: pi's edit tool applies fuzzy matching we cannot
    // replicate (its helpers are not exported); show oldText→newText instead.
    return { ...buildPatch(relPath, oldText, newText, false), exact: false };
  } catch (error) {
    return failed((error as Error).message);
  }
}
