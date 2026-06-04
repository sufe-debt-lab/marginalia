import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guards the prose docs against code-reference drift. Docs point at source by
// `path` (whole file) or `path#symbol` (a stable identifier/route/string inside
// it) — never `path:line`, because line numbers silently rot as code shifts
// above them. This test fails when a referenced file is gone, an anchored symbol
// no longer appears in it, or a banned `:line` reference sneaks back in.
//
// Convention for a *checked* reference (inline code span):
//   `apps/pi-server/src/app.ts`                            → file must exist
//   `apps/pi-server/src/app.ts#buildAgentMessage`          → file must contain "buildAgentMessage"
//   `apps/pi-server/src/app.ts#/sessions/:sessionId/runs`  → anchor may be a route/string
//   `apps/pi-server/src/app.ts:215`                        → BANNED (use a symbol anchor)
//
// Only tokens that are repo-root-relative (start with a known prefix) are
// checked; short prose mentions like `app.ts` and generated paths are ignored.
//
// This guards a repo-level docs convention but lives in the desktop package
// because the monorepo has no root test runner; `pnpm -r test` still runs it.
// If it moves, recompute repoRoot below (the sanity check catches a bad path).

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
if (!existsSync(path.join(repoRoot, "pnpm-workspace.yaml"))) {
  throw new Error(`repoRoot misresolved to ${repoRoot}`);
}

// docs/internal is intentionally excluded: it archives historical specs that
// may keep stale code references on purpose. Root README/CLAUDE.md reference
// source in prose (dir names, not file paths), so they don't trip isCheckedRef.
const DOC_DIRS = ["docs/user", "docs/developer"];

const CHECKED_PREFIXES = ["apps/", "packages/", ".github/", "docs/"];
// Build/runtime outputs absent from a clean checkout — referenced but not validated.
const GENERATED = [
  "/dist",
  "dist-electron",
  "/release",
  "node_modules",
  ".deploy",
  ".pnpm",
  "/resources/",
  "/output/"
];

function listMarkdown(absDir: string): string[] {
  return readdirSync(absDir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) return listMarkdown(full);
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}

function inlineCodeTokens(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** A token we should resolve against the repo: a clean, repo-root-relative path. */
function isCheckedRef(token: string): boolean {
  if (!CHECKED_PREFIXES.some((p) => token.startsWith(p))) return false;
  if (/[*<>\s]/.test(token)) return false; // globs, placeholders, prose, commands
  if (token.includes("..")) return false;
  if (GENERATED.some((g) => token.includes(g))) return false;
  return true;
}

function parseRef(token: string): { file: string; line: string | null; anchor: string | null } {
  const hash = token.indexOf("#");
  const anchor = hash >= 0 ? token.slice(hash + 1) : null;
  let file = hash >= 0 ? token.slice(0, hash) : token;
  const line = file.match(/:(\d+)$/)?.[1] ?? null;
  if (line) file = file.replace(/:\d+$/, "");
  return { file, line, anchor };
}

describe("docs code references", () => {
  const docs = DOC_DIRS.flatMap((d) => listMarkdown(path.join(repoRoot, d)));

  it("references real files by symbol, never by line number", () => {
    expect(docs.length, "no docs found — DOC_DIRS or repoRoot is wrong").toBeGreaterThan(0);
    const violations: string[] = [];
    for (const doc of docs) {
      const rel = path.relative(repoRoot, doc);
      const tokens = inlineCodeTokens(readFileSync(doc, "utf8")).filter(isCheckedRef);
      for (const token of tokens) {
        const { file, line, anchor } = parseRef(token);
        if (line) {
          violations.push(
            `${rel}: \`${token}\` uses a line number — reference \`${file}\` or \`${file}#<symbol>\` instead`
          );
          continue;
        }
        const abs = path.join(repoRoot, file);
        if (!existsSync(abs)) {
          violations.push(`${rel}: \`${token}\` → ${file} does not exist`);
          continue;
        }
        if (anchor) {
          if (statSync(abs).isDirectory()) {
            violations.push(`${rel}: \`${token}\` anchors a symbol but ${file} is a directory`);
            continue;
          }
          if (!readFileSync(abs, "utf8").includes(anchor)) {
            violations.push(`${rel}: \`${token}\` → "${anchor}" not found in ${file}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
