import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { URL } from "node:url";

import {
  checkAgentSymlink,
  checkCodeReferences,
  checkIssueInventoryConsistency,
  checkMarkdownLinks,
  checkPnpmScripts,
  checkStatusDocument,
  checkSuperpowerRecords,
  checkSuperpowerTransitions,
  collectMarkdownFiles,
  compareRouteInventories,
  evaluateDocsImpact,
  extractSourceRoutes,
  globToRegExp,
  loadDocsImpactDeclaration,
  parseDocsImpactComment,
  parseDocsCheckArgs,
  parseFrontMatter,
  parseRouteInventory,
  readGitDiff,
  runDiffChecks,
  validateDocsImpactConfig
} from "./docs-check-lib.mjs";

test("CLI arguments accept pnpm's standalone separator", () => {
  assert.deepEqual(parseDocsCheckArgs(["--", "--base", "HEAD"]), {
    base: "HEAD",
    declarationPath: null,
    githubEventPath: null
  });
  assert.throws(() => parseDocsCheckArgs(["--", "--unknown"]), /unknown argument/);
});

test("trusted docs workflow binds approval and status to the exact PR head", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/docs-gate.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /statuses: write/);
  assert.match(workflow, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /context=trusted-docs/);
  assert.match(workflow, /DOCS_CHECK_REQUIRE_FRESH_APPROVAL: "1"/);
  assert.match(workflow, /collaborators\/\$GITHUB_ACTOR\/permission/);
  assert.match(workflow, /types: \[[^\]]*edited[^\]]*\]/);
  assert.match(workflow, /group: trusted-docs-\$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(workflow, /cancel-in-progress: true/);
});

function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "marginalia-docs-check-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function initGit(root) {
  git(root, "init", "-q");
  git(root, "config", "user.email", "docs-check@example.test");
  git(root, "config", "user.name", "Docs Check");
}

function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-qm", message);
  return git(root, "rev-parse", "HEAD");
}

function activeSpec(id = "SPEC-TEST-001", status = "active") {
  return `---
type: spec
record_id: ${id}
status: ${status}
created: 2026-07-11
updated: 2026-07-11
target_milestone: M0
owner: maintainers
docs_impact:
  user:
    - docs/user/guide.md
  developer:
    - docs/developer/api.md
  product_status: true
---

# Test spec
`;
}

function archivedRecord({
  type = "spec",
  id = "SPEC-TEST-001",
  sourceSpecId,
  outcome = "completed",
  sameChange = false
} = {}) {
  return `---
type: ${type}
record_id: ${id}
status: archived
created: 2026-07-11
updated: 2026-07-11
target_milestone: M0
owner: maintainers
${sourceSpecId ? `source_spec_id: ${sourceSpecId}\n` : ""}docs_impact:
  user:
    - docs/user/guide.md
  developer:
    - docs/developer/api.md
  product_status: true
archived_at: 2026-07-11
outcome: ${outcome}
implementation_refs:
  - ${sameChange ? "same_change" : "1199645"}
${sameChange ? "same_change: true\n" : ""}---

# Archived

## Implementation Outcome

- Actual completed work: checker implementation completed.
- Incomplete or cancelled work: none.
- Spec deviations: documented in the source spec.
- Verification: node --test scripts/docs-check.test.mjs passed.
- Formal docs updated: docs/developer/api.md and docs/user/guide.md.
- Implementation reference: same_change.
- Remaining issues: none.
`;
}

test("parseFrontMatter accepts the controlled subset and rejects duplicate keys", () => {
  const parsed = parseFrontMatter(activeSpec());
  assert.equal(parsed.data.record_id, "SPEC-TEST-001");
  assert.deepEqual(parsed.data.docs_impact.user, ["docs/user/guide.md"]);
  assert.equal(parsed.data.docs_impact.product_status, true);
  assert.match(parsed.body, /# Test spec/);

  assert.throws(
    () => parseFrontMatter("---\ntype: spec\ntype: plan\n---\n# Duplicate\n"),
    /duplicate key/
  );
  assert.throws(() => parseFrontMatter("---\ntype:\n\t- spec\n---\n"), /tabs are not supported/);
});

test("Markdown links, fragments, source anchors, and path:line references are checked", () => {
  fixture((root) => {
    write(root, "README.md", "# Home\n\n## 单一事实源（single source of truth）\n");
    write(
      root,
      "docs/user/guide.md",
      "# Guide\n\n[home](../../README.md#单一事实源single-source-of-truth)\n" +
        "`apps/server.ts#buildApp`\n"
    );
    write(root, "apps/server.ts", "export function buildApp() {}\n");

    assert.deepEqual(checkMarkdownLinks(root, ["docs/user/guide.md"]), []);
    assert.deepEqual(checkCodeReferences(root, ["docs/user/guide.md"]), []);

    write(root, "docs/user/guide.md", "[missing](./missing.md)\n`apps/server.ts:12`\n");
    assert.match(checkMarkdownLinks(root, ["docs/user/guide.md"]).join("\n"), /missing\.md/);
    assert.match(checkCodeReferences(root, ["docs/user/guide.md"]).join("\n"), /line number/);

    write(root, "docs/user/guide.md", "`apps/server.ts#notThere`\n");
    assert.match(checkCodeReferences(root, ["docs/user/guide.md"]).join("\n"), /notThere/);

    write(root, "scripts/package-local.test.ts", "export {};\n");
    write(root, "docs/user/guide.md", "`scripts/package-local.test.ts`\n");
    assert.deepEqual(checkCodeReferences(root, ["docs/user/guide.md"]), []);
    rmSync(path.join(root, "scripts/package-local.test.ts"));
    assert.match(
      checkCodeReferences(root, ["docs/user/guide.md"]).join("\n"),
      /scripts\/package-local\.test\.ts/
    );
  });
});

test("Markdown and source reads reject symlinks, outside targets, and oversized files", () => {
  fixture((root) => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "marginalia-docs-outside-"));
    try {
      write(
        root,
        "docs/user/guide.md",
        "[outside](./outside.md#secret)\n`apps/outside.ts#secret`\n"
      );
      write(outside, "outside.md", "# Secret\n");
      write(outside, "outside.ts", "export const secret = true;\n");
      symlinkSync(path.join(outside, "outside.md"), path.join(root, "docs/user/outside.md"));
      mkdirSync(path.join(root, "apps"), { recursive: true });
      symlinkSync(path.join(outside, "outside.ts"), path.join(root, "apps/outside.ts"));

      assert.match(checkMarkdownLinks(root, ["docs/user/guide.md"]).join("\n"), /symlink/);
      assert.match(checkCodeReferences(root, ["docs/user/guide.md"]).join("\n"), /symlink/);

      write(root, "apps/real/inside.ts", "export const secret = true;\n");
      symlinkSync("real", path.join(root, "apps/link"));
      write(root, "docs/user/guide.md", "`apps/link/inside.ts#secret`\n");
      assert.match(checkCodeReferences(root, ["docs/user/guide.md"]).join("\n"), /symlink/);

      write(root, "docs/user/large.md", "x".repeat(2 * 1024 * 1024 + 1));
      assert.match(checkMarkdownLinks(root, ["docs/user/large.md"]).join("\n"), /2 MiB/);
      assert.equal(collectMarkdownFiles(root).includes("CLAUDE.md"), false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("Markdown discovery never traverses a symlinked documentation directory", () => {
  fixture((root) => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "marginalia-docs-tree-outside-"));
    try {
      write(outside, "outside.md", "# Outside\n");
      mkdirSync(path.join(root, "docs"), { recursive: true });
      symlinkSync(outside, path.join(root, "docs/user"));
      const files = collectMarkdownFiles(root);
      assert.equal(
        files.some((file) => file.endsWith("outside.md")),
        false
      );
      assert.equal(files.includes("docs/user"), true);
      assert.match(checkMarkdownLinks(root, files).join("\n"), /symlink/);

      rmSync(path.join(root, "docs"), { recursive: true, force: true });
      write(outside, "user/also-outside.md", "# Also outside\n");
      symlinkSync(outside, path.join(root, "docs"));
      const parentLinkedFiles = collectMarkdownFiles(root);
      assert.equal(
        parentLinkedFiles.some((file) => file.endsWith("also-outside.md")),
        false
      );
      assert.match(checkMarkdownLinks(root, parentLinkedFiles).join("\n"), /symlink/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("only unambiguous root pnpm commands are checked", () => {
  fixture((root) => {
    write(root, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    write(
      root,
      "docs/developer/development.md",
      "`pnpm test`\n`pnpm missing`\n`pnpm --filter @scope/pkg test`\n`pnpm run package-only`\n"
    );
    assert.deepEqual(checkPnpmScripts(root, ["docs/developer/development.md"]), [
      "docs/developer/development.md: root pnpm script does not exist: missing"
    ]);
  });
});

test("route inventory is an unordered exact set and rejects dynamic routes", () => {
  const source = `
    app.get("/health", handler);
    app.post(
      "/sessions",
      handler
    );
  `;
  const routes = extractSourceRoutes(source);
  assert.deepEqual(routes, [
    { method: "GET", path: "/health" },
    { method: "POST", path: "/sessions" }
  ]);

  const inventory = parseRouteInventory(`
<!-- route-inventory:start -->
| Method | Path | Description |
| --- | --- | --- |
| POST | \`/sessions\` | create |
| GET | \`/health\` | health |
<!-- route-inventory:end -->
`);
  assert.deepEqual(compareRouteInventories(routes, inventory), []);
  assert.match(
    compareRouteInventories(routes, inventory.slice(1)).join("\n"),
    /undocumented.*POST \/sessions/
  );
  assert.throws(
    () => extractSourceRoutes("const registration = app.get(routePath, handler);"),
    /dynamic or unsupported/
  );
  for (const delegated of [
    "app.route('/v1', child);",
    "app.on('GET', '/x', h);",
    "app.all('/x', h);",
    "app[method]('/x', h);"
  ]) {
    assert.throws(() => extractSourceRoutes(delegated), /delegated or dynamic/);
  }
});

test("glob matching, changed-line rules, and declarations are deterministic", () => {
  assert.equal(
    globToRegExp("apps/**/approval-*.ts").test("apps/pi/agent/approval-policy.ts"),
    true
  );
  assert.equal(globToRegExp("apps/*/app.ts").test("apps/pi/src/app.ts"), false);

  const rules = [
    {
      id: "api",
      paths: ["apps/server/**"],
      requireAll: ["docs/developer/api.md"]
    },
    {
      id: "provider-lines",
      paths: ["apps/server/app.ts"],
      changedLinePattern: "provider|apiKey",
      requireAll: ["docs/user/configuration.md"]
    }
  ];
  const changes = [{ status: "M", oldPath: "apps/server/app.ts", path: "apps/server/app.ts" }];
  const changedLines = new Map([["apps/server/app.ts", ["const provider = input.provider;"]]]);

  const missing = evaluateDocsImpact({ rules, changes, changedLines, declaration: null });
  assert.match(missing.errors.join("\n"), /docs\/developer\/api\.md/);
  assert.match(missing.errors.join("\n"), /docs\/user\/configuration\.md/);

  const declaration = {
    version: 1,
    exemptions: [
      {
        rule: "api",
        reason: "This internal refactor preserves every documented API behavior exactly."
      },
      {
        rule: "provider-lines",
        reason: "This rename does not change provider configuration or runtime selection behavior."
      }
    ]
  };
  assert.deepEqual(evaluateDocsImpact({ rules, changes, changedLines, declaration }).errors, []);

  assert.throws(
    () => parseDocsImpactComment("<!-- docs-impact: {bad json} -->"),
    /invalid docs-impact JSON/
  );
  assert.throws(() => parseDocsImpactComment('<!-- docs-impact: {"version":1}'), /not closed/);
  assert.throws(
    () =>
      parseDocsImpactComment(
        '<!-- docs-impact: {"version":1,"exemptions":[]} -->\n' +
          '<!-- docs-impact: {"version":1,"exemptions":[]} -->'
      ),
    /at most one/
  );
});

test("Superpowers records require a complete marked active index", () => {
  fixture((root) => {
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    write(root, "docs/superpowers/specs/test.md", activeSpec());
    write(
      root,
      "docs/superpowers/README.md",
      `# Active\n\n<!-- active-records:start -->\n| Record ID | Type | Status | Document |\n| --- | --- | --- | --- |\n| \`SPEC-TEST-001\` | spec | active | [test](./specs/test.md) |\n<!-- active-records:end -->\n`
    );
    assert.deepEqual(checkSuperpowerRecords(root).errors, []);

    write(root, "docs/superpowers/README.md", "# Active\n");
    assert.match(checkSuperpowerRecords(root).errors.join("\n"), /active-records:start/);
  });
});

test("product status requires snapshot fields, stable IDs, and legal states", () => {
  const valid = `# Status

Stage: Beta
Release decision: GO
Snapshot date: 2026-07-11
Verified commit: 1199645
Next milestone: M0 - Trustworthy Local Alpha

<!-- capability-inventory:start -->
| ID | Capability | Status |
| --- | --- | --- |
| CAP-SHELL-001 | Shell | partial |
<!-- capability-inventory:end -->

<!-- issue-inventory:start -->
| ID | Priority | Status | Last verified | Target |
| --- | --- | --- | --- | --- |
| ISSUE-SEC-001 | P0 | open | 2026-07-11 | M0 |
<!-- issue-inventory:end -->
`;
  assert.deepEqual(checkStatusDocument(valid), []);
  assert.match(checkStatusDocument(valid.replace("partial", "unknown")).join("\n"), /legal status/);
  assert.match(
    checkStatusDocument(
      valid.replace(
        "<!-- capability-inventory:end -->",
        "| CAP-SHELL-001 | Again | partial |\n<!-- capability-inventory:end -->"
      )
    ).join("\n"),
    /duplicate capability ID/
  );
  assert.match(
    checkStatusDocument(valid.replace("CAP-SHELL-001", "BAD-CAPABILITY-ID")).join("\n"),
    /invalid capability ID/
  );
  assert.match(
    checkStatusDocument(valid.replace("| partial |", "| unknown | partial |")).join("\n"),
    /legal status/
  );
  assert.match(
    checkStatusDocument(valid.replace("2026-07-11 | M0", "11/07/2026 | M0")).join("\n"),
    /Last verified/
  );
  assert.match(
    checkStatusDocument(valid.replace("Stage: Beta", "Stage: Prototype")).join("\n"),
    /Stage/
  );
});

test("status and readiness issue inventories must agree on core fields", () => {
  const status = `
<!-- issue-inventory:start -->
| ID | Priority | Status | Last verified | Target |
| --- | --- | --- | --- | --- |
| P0-SEC-001 | P0 | open | 2026-07-11 | M0 |
<!-- issue-inventory:end -->
`;
  const readiness = `# Audit

## Issue inventory

| ID | Priority | Status | Last verified | Target |
| --- | --- | --- | --- | --- |
| P0-SEC-001 | P0 | open | 2026-07-11 | M0 |

## Details
`;
  assert.deepEqual(checkIssueInventoryConsistency(status, readiness), []);
  assert.match(
    checkIssueInventoryConsistency(status, readiness.replace("| P0 | open", "| P1 | open")).join(
      "\n"
    ),
    /priority/
  );
  assert.match(
    checkIssueInventoryConsistency(status, readiness.replace("P0-SEC-001", "P1-OTHER-001")).join(
      "\n"
    ),
    /missing from readiness/
  );
});

test("agent rule symlink is validated in both the worktree and Git index", () => {
  fixture((root) => {
    initGit(root);
    write(root, "AGENTS.md", "# Rules\n");
    symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    git(root, "add", "AGENTS.md", "CLAUDE.md");
    assert.deepEqual(checkAgentSymlink(root), []);

    rmSync(path.join(root, "CLAUDE.md"));
    write(root, "CLAUDE.md", "AGENTS.md");
    assert.match(checkAgentSymlink(root).join("\n"), /symbolic link/);
  });
});

test("Git diff uses merge-base through the current worktree and includes untracked files", () => {
  fixture((root) => {
    initGit(root);
    write(root, "apps/server/app.ts", "const stable = true;\nconst value = 1;\n");
    const base = commitAll(root, "base");
    write(root, "apps/server/app.ts", "const stable = true;\nconst provider = 2;\n");
    write(root, "docs/developer/api.md", "# API\n");

    const diff = readGitDiff(root, base);
    assert.deepEqual(diff.changes, [
      { status: "M", oldPath: "apps/server/app.ts", path: "apps/server/app.ts" },
      { status: "A", oldPath: "docs/developer/api.md", path: "docs/developer/api.md" }
    ]);
    assert.deepEqual(diff.changedLines.get("apps/server/app.ts"), [
      "const value = 1;",
      "const provider = 2;"
    ]);
    assert.equal(
      diff.changedLines.get("apps/server/app.ts").includes("const stable = true;"),
      false
    );
    assert.deepEqual(diff.changedLines.get("docs/developer/api.md"), ["# API"]);
  });
});

test("Git diff preserves staged changes that the worktree reverses", () => {
  fixture((root) => {
    initGit(root);
    const original = "const value = 1;\n";
    write(root, "apps/server/app.ts", original);
    const base = commitAll(root, "base");

    write(root, "apps/server/app.ts", "const provider = input.provider;\n");
    git(root, "add", "apps/server/app.ts");
    write(root, "apps/server/app.ts", original);

    const diff = readGitDiff(root, base);
    assert.equal(
      diff.changes.some((change) => change.path === "apps/server/app.ts"),
      true
    );
    assert.equal(
      diff.changedLines.get("apps/server/app.ts").includes("const provider = input.provider;"),
      true
    );
    const result = evaluateDocsImpact({
      rules: [
        {
          id: "provider-lines",
          paths: ["apps/server/app.ts"],
          changedLinePattern: "provider",
          requireAll: ["docs/user/configuration.md"]
        }
      ],
      changes: diff.changes,
      changedLines: diff.changedLines,
      declaration: null
    });
    assert.match(result.errors.join("\n"), /provider-lines/);
  });
});

test("changed-line rules cannot be bypassed by making a tracked source file binary", () => {
  fixture((root) => {
    initGit(root);
    write(root, "apps/server/app.ts", "export const value = 1;\n");
    const base = commitAll(root, "base");
    write(root, "apps/server/app.ts", "const provider = input.provider;\n\0");
    const diff = readGitDiff(root, base);
    const result = evaluateDocsImpact({
      rules: [
        {
          id: "provider-lines",
          paths: ["apps/server/app.ts"],
          changedLinePattern: "provider",
          requireAll: ["docs/user/configuration.md"]
        }
      ],
      changes: diff.changes,
      changedLines: diff.changedLines,
      declaration: null
    });
    assert.match(result.errors.join("\n"), /provider-lines/);
  });
});

test("changed-line parsing preserves source lines that begin with ++ or --", () => {
  fixture((root) => {
    initGit(root);
    write(root, "apps/server/app.ts", "let provider = 0;\nlet permission = 1;\n");
    const base = commitAll(root, "base");
    write(
      root,
      "apps/server/app.ts",
      "let provider = 0;\nlet permission = 1;\n++provider;\n--permission;\n"
    );
    const diff = readGitDiff(root, base);
    assert.deepEqual(diff.changedLines.get("apps/server/app.ts"), ["++provider;", "--permission;"]);
  });
});

test("same-change closeout is limited to a completed spec and its plan", () => {
  fixture((root) => {
    initGit(root);
    write(root, "README.md", "base\n");
    const base = commitAll(root, "base");
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    write(
      root,
      "docs/internal/specs/task.md",
      archivedRecord({ id: "SPEC-SAME-001", sameChange: true })
    );
    write(
      root,
      "docs/internal/plans/task.md",
      archivedRecord({
        type: "plan",
        id: "PLAN-SAME-001",
        sourceSpecId: "SPEC-SAME-001",
        sameChange: true
      })
    );
    commitAll(root, "same change closeout");

    assert.deepEqual(checkSuperpowerTransitions(root, base), []);

    const mergedBase = git(root, "rev-parse", "HEAD");
    write(root, "README.md", "next change\n");
    assert.deepEqual(checkSuperpowerTransitions(root, mergedBase), []);

    write(
      root,
      "docs/internal/plans/task.md",
      archivedRecord({
        type: "plan",
        id: "PLAN-SAME-001",
        sourceSpecId: "SPEC-MISSING-001",
        sameChange: true
      })
    );
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /same-change archived spec/);

    write(
      root,
      "docs/internal/plans/task.md",
      archivedRecord({
        type: "plan",
        id: "PLAN-SAME-001",
        sourceSpecId: "SPEC-SAME-001",
        sameChange: true
      }).replace("  - same_change", "  - same change")
    );
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /same_change/);
  });
});

test("active lifecycle transitions are forward-only and existing archives are immutable", () => {
  fixture((root) => {
    initGit(root);
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    write(root, "docs/superpowers/specs/test.md", activeSpec("SPEC-STATE-001", "draft"));
    const base = commitAll(root, "draft");

    write(root, "docs/superpowers/specs/test.md", activeSpec("SPEC-STATE-001", "approved"));
    assert.deepEqual(checkSuperpowerTransitions(root, base), []);
    write(root, "docs/superpowers/specs/test.md", activeSpec("SPEC-STATE-001", "active"));
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /draft.*active/);
  });

  fixture((root) => {
    initGit(root);
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    const archivePath = "docs/internal/specs/test.md";
    write(root, archivePath, archivedRecord({ id: "SPEC-ARCHIVE-001" }));
    const base = commitAll(root, "archive");

    write(root, archivePath, `${readFileSync(path.join(root, archivePath), "utf8")}\nchanged\n`);
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /immutable/);

    rmSync(path.join(root, archivePath));
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /must not be deleted/);

    write(root, "docs/superpowers/specs/test.md", activeSpec("SPEC-ARCHIVE-001", "active"));
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /reopen/);
  });
});

test("archive immutability cannot be bypassed with invalid UTF-8 bytes", () => {
  fixture((root) => {
    initGit(root);
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    const archivePath = path.join(root, "docs/internal/specs/bytes.md");
    mkdirSync(path.dirname(archivePath), { recursive: true });
    const archive = Buffer.from(archivedRecord({ id: "SPEC-BYTES-001" }));
    writeFileSync(archivePath, Buffer.concat([archive, Buffer.from([0x80])]));
    const base = commitAll(root, "archive with invalid byte");
    writeFileSync(archivePath, Buffer.concat([archive, Buffer.from([0x81])]));
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /UTF-8|immutable/);
  });
});

test("lifecycle checks preserve control characters in Git tree paths", () => {
  fixture((root) => {
    initGit(root);
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    const unusualPath = "docs/superpowers/specs/weird\nname.md";
    write(root, unusualPath, activeSpec("SPEC-WEIRD-PATH-001", "active"));
    const base = commitAll(root, "active record with unusual path");
    rmSync(path.join(root, unusualPath));
    write(
      root,
      "docs/internal/specs/weird-name.md",
      archivedRecord({ id: "SPEC-WEIRD-PATH-001", sameChange: true })
    );
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /cannot use same_change/);
  });
});

test("new internal records require archive metadata", () => {
  fixture((root) => {
    initGit(root);
    write(root, "README.md", "base\n");
    const base = commitAll(root, "base");
    write(root, "docs/internal/plans/no-metadata.md", "# Not an archive record\n");
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /archive metadata/);
  });
});

test("same_change implementation references require the restricted same-change flag", () => {
  fixture((root) => {
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    write(
      root,
      "docs/superpowers/README.md",
      "# Active\n\n<!-- active-records:start -->\n<!-- active-records:end -->\n"
    );
    write(
      root,
      "docs/internal/specs/test.md",
      archivedRecord({ id: "SPEC-REF-001" }).replace("  - 1199645", "  - same_change")
    );
    assert.match(
      checkSuperpowerRecords(root).errors.join("\n"),
      /same_change.*flag|flag.*same_change/
    );

    write(
      root,
      "docs/internal/specs/test.md",
      archivedRecord({ id: "SPEC-REF-001" }).replace("  - 1199645", "  - not-a-reference")
    );
    assert.match(
      checkSuperpowerRecords(root).errors.join("\n"),
      /invalid implementation reference/
    );

    write(
      root,
      "docs/internal/specs/test.md",
      archivedRecord({ id: "SPEC-REF-001" }).replace(
        /## Implementation Outcome[\s\S]*/,
        "## Implementation Outcome\n\n- Incomplete.\n"
      )
    );
    assert.match(
      checkSuperpowerRecords(root).errors.join("\n"),
      /incomplete Implementation Outcome/
    );
  });
});

test("legacy transitions require the exact migration baseline hash", () => {
  fixture((root) => {
    initGit(root);
    const legacy = "# Legacy active plan\n";
    write(root, "docs/superpowers/plans/legacy.md", legacy);
    write(root, "docs/superpowers/specs/source.md", activeSpec("SPEC-LEGACY-001"));
    const base = commitAll(root, "legacy base");
    const sha256 = createHash("sha256").update(legacy).digest("hex");
    rmSync(path.join(root, "docs/superpowers/plans/legacy.md"));
    rmSync(path.join(root, "docs/superpowers/specs/source.md"));
    write(root, "docs/user/guide.md", "# Guide\n");
    write(root, "docs/developer/api.md", "# API\n");
    write(
      root,
      "docs/internal/plans/legacy.md",
      archivedRecord({
        type: "plan",
        id: "PLAN-LEGACY-001",
        sourceSpecId: "SPEC-LEGACY-001",
        outcome: "cancelled"
      })
    );
    write(
      root,
      "docs/internal/specs/source.md",
      archivedRecord({ id: "SPEC-LEGACY-001", outcome: "cancelled" })
    );
    write(
      root,
      "docs/contracts/superpowers-migration-baseline.json",
      JSON.stringify({
        version: 1,
        lockedAt: "2026-07-11",
        records: [
          {
            sourcePath: "docs/superpowers/plans/legacy.md",
            sha256,
            recordId: "PLAN-LEGACY-001",
            assumedStatus: "active"
          }
        ]
      })
    );
    commitAll(root, "archive legacy");
    assert.deepEqual(checkSuperpowerTransitions(root, base), []);

    const baselinePath = path.join(root, "docs/contracts/superpowers-migration-baseline.json");
    const bad = JSON.parse(readFileSync(baselinePath, "utf8"));
    bad.records[0].sha256 = "0".repeat(64);
    writeFileSync(baselinePath, JSON.stringify(bad));
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /SHA-256 mismatch/);
  });
});

test("a merged migration baseline is immutable and cannot be deleted", () => {
  fixture((root) => {
    initGit(root);
    const baselinePath = "docs/contracts/superpowers-migration-baseline.json";
    const padding = "\n".repeat(1_100_000);
    write(root, baselinePath, `${JSON.stringify({ version: 1, records: [] })}${padding}`);
    const base = commitAll(root, "baseline");
    write(
      root,
      baselinePath,
      `${JSON.stringify({ version: 1, records: [], changed: true })}${padding}`
    );
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /locked.*must not change/);
    rmSync(path.join(root, baselinePath));
    assert.match(checkSuperpowerTransitions(root, base).join("\n"), /must not be deleted/);
  });
});

test("docs-impact config is statically validated and diff checks accept a trusted override", () => {
  fixture((root) => {
    initGit(root);
    write(root, "docs/developer/api.md", "# API\n");
    const canonical = {
      version: 1,
      rules: [{ id: "api", paths: ["apps/server/**"], requireAll: ["docs/developer/api.md"] }]
    };
    write(root, "docs/contracts/docs-impact.json", JSON.stringify(canonical));
    write(root, "apps/server/app.ts", "export const value = 1;\n");
    const base = commitAll(root, "base");
    write(root, "apps/server/app.ts", "export const value = 2;\n");

    assert.deepEqual(validateDocsImpactConfig(root, canonical), []);
    assert.match(validateDocsImpactConfig(root, { version: 1, rules: [] }).join("\n"), /non-empty/);
    assert.match(
      validateDocsImpactConfig(root, {
        version: 1,
        rules: [{ id: "bad", paths: [12], requireAll: ["docs/missing.md"] }]
      }).join("\n"),
      /string/
    );
    assert.match(runDiffChecks(root, base).join("\n"), /docs\/developer\/api\.md/);

    const overridePath = path.join(root, "override.json");
    write(
      root,
      "override.json",
      JSON.stringify({
        version: 1,
        rules: [{ id: "other", paths: ["other/**"], requireAll: ["docs/developer/api.md"] }]
      })
    );
    assert.deepEqual(runDiffChecks(root, base, null, { impactConfigPath: overridePath }), []);
  });
});

test("GitHub-event exemptions require the docs-impact-approved label", () => {
  fixture((root) => {
    const declaration = {
      version: 1,
      exemptions: [
        { rule: "api", reason: "This is a sufficiently specific internal-only refactor reason." }
      ]
    };
    const eventPath = path.join(root, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          body: `<!-- docs-impact: ${JSON.stringify(declaration)} -->`,
          labels: []
        }
      })
    );
    assert.throws(
      () => loadDocsImpactDeclaration({ githubEventPath: eventPath }),
      /docs-impact-approved/
    );

    writeFileSync(
      eventPath,
      JSON.stringify({
        action: "synchronize",
        pull_request: {
          body: `<!-- docs-impact: ${JSON.stringify(declaration)} -->`,
          labels: [{ name: "docs-impact-approved" }]
        }
      })
    );
    assert.deepEqual(loadDocsImpactDeclaration({ githubEventPath: eventPath }), declaration);
    assert.throws(
      () =>
        loadDocsImpactDeclaration({
          githubEventPath: eventPath,
          requireFreshApproval: true
        }),
      /latest PR head|fresh/i
    );

    writeFileSync(
      eventPath,
      JSON.stringify({
        action: "labeled",
        label: { name: "docs-impact-approved" },
        pull_request: {
          body: `<!-- docs-impact: ${JSON.stringify(declaration)} -->`,
          labels: [{ name: "docs-impact-approved" }]
        }
      })
    );
    assert.deepEqual(
      loadDocsImpactDeclaration({ githubEventPath: eventPath, requireFreshApproval: true }),
      declaration
    );

    const declarationPath = path.join(root, "declaration.json");
    writeFileSync(declarationPath, JSON.stringify(declaration));
    assert.deepEqual(loadDocsImpactDeclaration({ declarationPath }), declaration);
  });
});
