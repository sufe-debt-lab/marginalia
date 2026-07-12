import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";

const ACTIVE_STATES = new Set(["draft", "approved", "active"]);
const ARCHIVE_OUTCOMES = new Set(["completed", "cancelled", "superseded"]);
const CAPABILITY_STATES = new Set(["implemented", "partial", "disabled", "planned"]);
const ISSUE_STATES = new Set(["open", "in-progress", "blocked", "resolved"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const RECORD_ID = /^(SPEC|PLAN)-[A-Za-z0-9][A-Za-z0-9-]*-\d{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_PREFIXES = ["apps/", "packages/", "scripts/", ".github/", "docs/"];
const MAX_READ_BYTES = 2 * 1024 * 1024;
const GIT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const ROOT_CODE_PATHS = new Set(["package.json", "pnpm-workspace.yaml", "AGENTS.md", "CLAUDE.md"]);
const GENERATED_PATH_PARTS = [
  "/dist/",
  "dist-electron",
  "/release/",
  "node_modules",
  ".deploy",
  ".pnpm",
  "/resources/",
  "/output/"
];
const PNPM_BUILT_INS = new Set([
  "add",
  "audit",
  "config",
  "create",
  "deploy",
  "dlx",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "link",
  "list",
  "outdated",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "run",
  "setup",
  "store",
  "unlink",
  "update",
  "why"
]);

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function relative(root, absolutePath) {
  return normalizePath(path.relative(root, absolutePath));
}

function listFiles(root, predicate) {
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    return [];
  }
  if (rootStat.isSymbolicLink()) return [root];
  if (!rootStat.isDirectory()) return rootStat.isFile() && predicate(root) ? [root] : [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(absolutePath, predicate);
    if (entry.isSymbolicLink()) return [absolutePath];
    return entry.isFile() && predicate(absolutePath) ? [absolutePath] : [];
  });
}

function listRepoFiles(repoRoot, directory, predicate) {
  const absoluteDirectory = path.join(repoRoot, directory);
  try {
    lstatSync(absoluteDirectory);
  } catch {
    return [];
  }
  try {
    safeRepoPath(repoRoot, directory, { allowDirectory: true });
  } catch {
    return [absoluteDirectory];
  }
  return listFiles(absoluteDirectory, predicate);
}

function safeRepoPath(
  repoRoot,
  relativePath,
  { allowDirectory = false, allowClaudeSymlink = false, forRead = false } = {}
) {
  const normalized = normalizePath(relativePath);
  if (!normalized || path.isAbsolute(relativePath))
    throw new Error(`unsafe repository path: ${relativePath}`);
  const absolutePath = path.resolve(repoRoot, normalized);
  const lexicalRoot = path.resolve(repoRoot);
  if (pathEscapesRoot(lexicalRoot, absolutePath)) {
    throw new Error(`path escapes the repository: ${relativePath}`);
  }
  const lexicalRelative = path.relative(lexicalRoot, absolutePath);
  let cursor = lexicalRoot;
  for (const segment of lexicalRelative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let componentStat;
    try {
      componentStat = lstatSync(cursor);
    } catch {
      break;
    }
    if (componentStat.isSymbolicLink()) {
      const claudeLink =
        cursor === absolutePath &&
        normalized === "CLAUDE.md" &&
        readlinkSync(cursor) === "AGENTS.md";
      if (!allowClaudeSymlink || !claudeLink) {
        throw new Error(`repository symlink is not allowed: ${relativePath}`);
      }
    }
  }
  try {
    lstatSync(absolutePath);
  } catch {
    throw new Error(`path does not exist: ${relativePath}`);
  }
  const realRoot = realpathSync(repoRoot);
  const realPath = realpathSync(absolutePath);
  if (pathEscapesRoot(realRoot, realPath)) {
    throw new Error(`resolved path escapes the repository: ${relativePath}`);
  }
  const resolvedStat = statSync(realPath);
  if (resolvedStat.isDirectory()) {
    if (!allowDirectory) throw new Error(`path is not a regular file: ${relativePath}`);
  } else if (!resolvedStat.isFile()) {
    throw new Error(`path is not a regular file: ${relativePath}`);
  }
  if (forRead && resolvedStat.size > MAX_READ_BYTES) {
    throw new Error(`file exceeds the 2 MiB read limit: ${relativePath}`);
  }
  return { absolutePath, realPath, stat: resolvedStat };
}

function readRepoBuffer(root, relativePath) {
  const resolved = safeRepoPath(root, relativePath, {
    allowClaudeSymlink: relativePath === "CLAUDE.md",
    forRead: true
  });
  return readFileSync(resolved.realPath);
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`invalid UTF-8 in ${label}`, { cause: error });
  }
}

function read(root, relativePath) {
  return decodeUtf8(readRepoBuffer(root, relativePath), relativePath);
}

function readTrustedFile(file) {
  const absolutePath = path.resolve(file);
  const lexicalStat = lstatSync(absolutePath);
  if (lexicalStat.isSymbolicLink() || !lexicalStat.isFile()) {
    throw new Error(`trusted input must be a regular non-symlink file: ${file}`);
  }
  if (lexicalStat.size > MAX_READ_BYTES) throw new Error(`trusted input exceeds 2 MiB: ${file}`);
  return decodeUtf8(readFileSync(absolutePath), file);
}

function parseScalar(raw, lineNumber) {
  const value = raw.trim();
  if (!value) throw new Error(`line ${lineNumber}: empty scalar`);
  if (value === "true") return true;
  if (value === "false") return false;
  if (
    value.startsWith("[") ||
    value.startsWith("{") ||
    value.endsWith("]") ||
    value.endsWith("}") ||
    value === "|" ||
    value === ">"
  ) {
    throw new Error(`line ${lineNumber}: inline collections and block scalars are not supported`);
  }
  if (value.startsWith('"') || value.startsWith("'")) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        throw new Error(`line ${lineNumber}: invalid quoted scalar`);
      }
    }
    if (!value.endsWith("'")) throw new Error(`line ${lineNumber}: invalid quoted scalar`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

export function parseFrontMatter(markdown) {
  const text = markdown.replaceAll("\r\n", "\n");
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error("front matter must start on the first line");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("front matter closing delimiter is missing");

  const data = {};
  let topKey = null;
  let nestedKey = null;
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.includes("\t")) throw new Error(`line ${index + 1}: tabs are not supported`);
    const indent = line.length - line.trimStart().length;
    if (![0, 2, 4].includes(indent)) {
      throw new Error(`line ${index + 1}: indentation must be 0, 2, or 4 spaces`);
    }
    const content = line.slice(indent);

    if (indent === 0) {
      const match = content.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
      if (!match) throw new Error(`line ${index + 1}: expected a top-level key`);
      const [, key, raw] = match;
      if (Object.hasOwn(data, key)) throw new Error(`line ${index + 1}: duplicate key ${key}`);
      data[key] = raw.trim() ? parseScalar(raw, index + 1) : null;
      topKey = key;
      nestedKey = null;
      continue;
    }

    if (!topKey) throw new Error(`line ${index + 1}: nested value has no parent`);
    if (indent === 2 && content.startsWith("- ")) {
      if (data[topKey] === null) data[topKey] = [];
      if (!Array.isArray(data[topKey])) {
        throw new Error(`line ${index + 1}: ${topKey} mixes mapping and sequence values`);
      }
      data[topKey].push(parseScalar(content.slice(2), index + 1));
      nestedKey = null;
      continue;
    }

    if (indent === 2) {
      const match = content.match(/^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/);
      if (!match) throw new Error(`line ${index + 1}: expected a nested key`);
      const [, key, raw] = match;
      if (data[topKey] === null) data[topKey] = {};
      if (!data[topKey] || Array.isArray(data[topKey]) || typeof data[topKey] !== "object") {
        throw new Error(`line ${index + 1}: ${topKey} is not a mapping`);
      }
      if (Object.hasOwn(data[topKey], key)) {
        throw new Error(`line ${index + 1}: duplicate key ${topKey}.${key}`);
      }
      data[topKey][key] = raw.trim() ? parseScalar(raw, index + 1) : null;
      nestedKey = key;
      continue;
    }

    if (!nestedKey || !data[topKey] || Array.isArray(data[topKey])) {
      throw new Error(`line ${index + 1}: sequence has no nested key`);
    }
    if (!content.startsWith("- ")) {
      throw new Error(`line ${index + 1}: only nested sequences are supported at four spaces`);
    }
    if (data[topKey][nestedKey] === null) data[topKey][nestedKey] = [];
    if (!Array.isArray(data[topKey][nestedKey])) {
      throw new Error(`line ${index + 1}: ${topKey}.${nestedKey} is not a sequence`);
    }
    data[topKey][nestedKey].push(parseScalar(content.slice(2), index + 1));
  }

  return { data, body: lines.slice(end + 1).join("\n"), raw: lines.slice(1, end).join("\n") };
}

function stripFencedCode(markdown) {
  let fence = null;
  return markdown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? null;
      if (marker) {
        if (!fence) fence = marker[0];
        else if (marker[0] === fence) fence = null;
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}

function headingTextToSlug(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/!??\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[\\*_~]/g, "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

export function githubHeadingIds(markdown) {
  const counts = new Map();
  const ids = new Set();
  for (const line of stripFencedCode(markdown).split("\n")) {
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = headingTextToSlug(heading);
    const count = counts.get(base) ?? 0;
    ids.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return ids;
}

function extractLinkTargets(markdown) {
  const text = stripFencedCode(markdown);
  const targets = [];
  for (const match of text.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) targets.push(match[1]);
  for (const match of text.matchAll(/^\s*\[[^\]\n]+\]:\s*(\S+)/gm)) targets.push(match[1]);
  return targets;
}

function cleanLinkTarget(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(/\s+/, 1)[0];
}

function pathEscapesRoot(root, absolutePath) {
  const rel = path.relative(root, absolutePath);
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

export function checkMarkdownLinks(repoRoot, relativeFiles) {
  const errors = [];
  const headingCache = new Map();
  for (const file of relativeFiles) {
    let markdown;
    try {
      markdown = read(repoRoot, file);
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      continue;
    }
    for (const rawTarget of extractLinkTargets(markdown)) {
      const target = cleanLinkTarget(rawTarget);
      if (!target || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith("//")) continue;
      const hash = target.indexOf("#");
      const rawPath = hash >= 0 ? target.slice(0, hash) : target;
      const rawFragment = hash >= 0 ? target.slice(hash + 1) : "";
      let decodedPath;
      let decodedFragment;
      try {
        decodedPath = decodeURIComponent(rawPath);
        decodedFragment = decodeURIComponent(rawFragment).toLocaleLowerCase("en-US");
      } catch {
        errors.push(`${file}: invalid percent encoding in link ${target}`);
        continue;
      }
      const absoluteTarget = decodedPath
        ? path.resolve(repoRoot, path.dirname(file), decodedPath)
        : path.join(repoRoot, file);
      if (pathEscapesRoot(repoRoot, absoluteTarget)) {
        errors.push(`${file}: link escapes the repository: ${target}`);
        continue;
      }
      const targetPath = relative(repoRoot, absoluteTarget);
      let resolvedTarget;
      try {
        resolvedTarget = safeRepoPath(repoRoot, targetPath, {
          allowDirectory: true,
          allowClaudeSymlink: targetPath === "CLAUDE.md"
        });
      } catch (error) {
        errors.push(`${file}: ${error.message}`);
        continue;
      }
      if (!decodedFragment) continue;
      let headingPath = targetPath;
      if (resolvedTarget.stat.isDirectory())
        headingPath = normalizePath(path.join(targetPath, "README.md"));
      if (!headingPath.endsWith(".md")) {
        errors.push(`${file}: link fragment targets a non-Markdown file: ${target}`);
        continue;
      }
      if (!headingCache.has(headingPath)) {
        try {
          headingCache.set(headingPath, githubHeadingIds(read(repoRoot, headingPath)));
        } catch (error) {
          errors.push(`${file}: ${error.message}`);
          continue;
        }
      }
      if (!headingCache.get(headingPath).has(decodedFragment)) {
        errors.push(`${file}: heading fragment not found: ${target}`);
      }
    }
  }
  return errors;
}

function inlineCodeTokens(markdown) {
  return [...stripFencedCode(markdown).matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

function isCheckedCodeReference(token) {
  if (
    ![...CODE_PREFIXES].some((prefix) => token.startsWith(prefix)) &&
    !ROOT_CODE_PATHS.has(token)
  ) {
    return false;
  }
  if (/[*<>\s]/.test(token) || token.includes("..")) return false;
  return !GENERATED_PATH_PARTS.some((part) => `/${token}`.includes(part));
}

function isFormalDocument(file) {
  return (
    file === "README.md" ||
    file === "AGENTS.md" ||
    file === "CLAUDE.md" ||
    file === "docs/README.md" ||
    file.startsWith("docs/product/") ||
    file.startsWith("docs/user/") ||
    file.startsWith("docs/developer/")
  );
}

export function checkCodeReferences(repoRoot, relativeFiles) {
  const errors = [];
  for (const file of relativeFiles) {
    let markdown;
    try {
      markdown = read(repoRoot, file);
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      continue;
    }
    for (const token of inlineCodeTokens(markdown).filter(isCheckedCodeReference)) {
      const hash = token.indexOf("#");
      const anchor = hash >= 0 ? token.slice(hash + 1) : null;
      let sourcePath = hash >= 0 ? token.slice(0, hash) : token;
      const lineNumber = sourcePath.match(/:(\d+)(?:-\d+)?$/)?.[1] ?? null;
      if (lineNumber) sourcePath = sourcePath.replace(/:\d+(?:-\d+)?$/, "");
      if (lineNumber && isFormalDocument(file)) {
        errors.push(`${file}: ${token} uses a line number; use a file or symbol anchor instead`);
        continue;
      }
      let resolved;
      try {
        resolved = safeRepoPath(repoRoot, sourcePath, {
          allowDirectory: true,
          allowClaudeSymlink: sourcePath === "CLAUDE.md"
        });
      } catch (error) {
        errors.push(`${file}: referenced source ${error.message}`);
        continue;
      }
      if (anchor) {
        if (resolved.stat.isDirectory()) {
          errors.push(`${file}: ${token} anchors a directory`);
        } else {
          try {
            if (!read(repoRoot, sourcePath).includes(anchor)) {
              errors.push(`${file}: anchor ${anchor} was not found in ${sourcePath}`);
            }
          } catch (error) {
            errors.push(`${file}: ${error.message}`);
          }
        }
      }
    }
  }
  return errors;
}

export function collectMarkdownFiles(repoRoot) {
  const files = [];
  for (const rootFile of ["README.md", "AGENTS.md", "docs/README.md"]) {
    try {
      lstatSync(path.join(repoRoot, rootFile));
      files.push(rootFile);
    } catch {
      // Missing root documents are reported by their dedicated checks when required.
    }
  }
  for (const directory of ["docs/product", "docs/user", "docs/developer", "docs/superpowers"]) {
    files.push(
      ...listRepoFiles(repoRoot, directory, (file) => file.endsWith(".md")).map((file) =>
        relative(repoRoot, file)
      )
    );
  }
  try {
    lstatSync(path.join(repoRoot, "docs/internal/README.md"));
    files.push("docs/internal/README.md");
  } catch {
    // The internal index is optional until the directory exists.
  }
  return [...new Set(files)].sort();
}

export function checkPnpmScripts(repoRoot, files) {
  const errors = [];
  const scripts = JSON.parse(read(repoRoot, "package.json")).scripts ?? {};
  for (const file of files) {
    let markdown;
    try {
      markdown = read(repoRoot, file).replaceAll("\r\n", "\n");
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      continue;
    }
    const candidates = [];
    for (const token of inlineCodeTokens(markdown)) {
      const exact = token.trim().match(/^pnpm\s+([A-Za-z0-9:_-]+)$/);
      if (exact) candidates.push(exact[1]);
    }
    for (const line of markdown.split("\n")) {
      for (const segment of line.split("&&")) {
        const commandLine = segment.trim().replace(/^\$\s*/, "");
        const match = commandLine.match(/^pnpm\s+([^\s#]+)/);
        if (match && !match[1].startsWith("-") && !/^\d/.test(match[1])) candidates.push(match[1]);
      }
    }
    for (const command of candidates) {
      if (!PNPM_BUILT_INS.has(command) && !Object.hasOwn(scripts, command)) {
        errors.push(`${file}: root pnpm script does not exist: ${command}`);
      }
    }
  }
  return errors;
}

function checkAgentReferences(repoRoot) {
  const errors = [];
  for (const file of ["AGENTS.md"]) {
    const absolutePath = path.join(repoRoot, file);
    if (!existsSync(absolutePath)) {
      errors.push(`${file} does not exist`);
      continue;
    }
    let text;
    try {
      text = stripFencedCode(read(repoRoot, file));
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      continue;
    }
    for (const match of text.matchAll(/^\s*@([^\s]+)\s*$/gm)) {
      const referenced = match[1];
      try {
        safeRepoPath(repoRoot, referenced, { allowDirectory: true });
      } catch (error) {
        errors.push(`${file}: local agent reference ${error.message}`);
      }
    }
  }
  return errors;
}

function markdownFilesAt(repoRoot, directory, recursive = true) {
  const absoluteDirectory = path.join(repoRoot, directory);
  try {
    lstatSync(absoluteDirectory);
  } catch {
    return [];
  }
  if (recursive) {
    return listRepoFiles(repoRoot, directory, (file) => file.endsWith(".md")).map((file) =>
      relative(repoRoot, file)
    );
  }
  try {
    safeRepoPath(repoRoot, directory, { allowDirectory: true });
  } catch {
    return [directory];
  }
  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink() || (entry.isFile() && entry.name.endsWith(".md")))
    .map((entry) => normalizePath(path.join(directory, entry.name)));
}

function loadCurrentRecords(repoRoot) {
  const records = [];
  const errors = [];
  const activeFiles = [
    ...markdownFilesAt(repoRoot, "docs/superpowers/specs"),
    ...markdownFilesAt(repoRoot, "docs/superpowers/plans")
  ];
  for (const file of activeFiles) {
    try {
      const parsed = parseFrontMatter(read(repoRoot, file));
      records.push({ ...parsed, path: file, scope: "active" });
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  const archiveFiles = [
    ...markdownFilesAt(repoRoot, "docs/internal/specs", false),
    ...markdownFilesAt(repoRoot, "docs/internal/plans", false)
  ];
  for (const file of archiveFiles) {
    try {
      const content = read(repoRoot, file);
      if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) continue;
      const parsed = parseFrontMatter(content);
      if (!parsed.data.record_id) {
        errors.push(`${file}: archived front matter is missing record_id`);
      } else {
        records.push({ ...parsed, path: file, scope: "archive" });
      }
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  return { records, errors };
}

function validateDocsImpact(repoRoot, record, errors) {
  const impact = record.data.docs_impact;
  if (!impact || Array.isArray(impact) || typeof impact !== "object") {
    errors.push(`${record.path}: docs_impact must be a mapping`);
    return;
  }
  for (const key of ["user", "developer"]) {
    if (!Array.isArray(impact[key])) {
      errors.push(`${record.path}: docs_impact.${key} must be a sequence`);
      continue;
    }
    for (const doc of impact[key]) {
      if (typeof doc !== "string" || !doc.startsWith(`docs/${key}/`)) {
        errors.push(`${record.path}: invalid docs_impact.${key} path ${String(doc)}`);
      } else if (record.scope === "active") {
        try {
          safeRepoPath(repoRoot, doc);
        } catch (error) {
          errors.push(`${record.path}: docs impact ${error.message}`);
        }
      }
    }
  }
  if (typeof impact.product_status !== "boolean") {
    errors.push(`${record.path}: docs_impact.product_status must be true or false`);
  }
}

function outcomeSection(body) {
  const heading = /^## Implementation Outcome\s*$/m.exec(body);
  if (!heading) return "";
  const rest = body.slice(heading.index + heading[0].length);
  const nextHeading = /^##\s/m.exec(rest);
  return rest.slice(0, nextHeading?.index ?? rest.length).trim();
}

function isImplementationReference(value) {
  if (typeof value !== "string") return false;
  return (
    value === "same_change" ||
    /^[0-9a-f]{7,40}$/.test(value) ||
    /^(?:PR)?#[1-9]\d*$/i.test(value) ||
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:commit\/[0-9a-f]{7,40}|pull\/[1-9]\d*)(?:[?#][^\s]*)?$/.test(
      value
    )
  );
}

function hasCompleteSameChangeOutcome(record) {
  const section = outcomeSection(record.body);
  const meaningfulLines = section.split("\n").filter((line) => line.trim()).length;
  return (
    meaningfulLines >= 7 &&
    /(?:pnpm|node\s+--test)/i.test(section) &&
    /docs\//.test(section) &&
    /\bsame_change\b/.test(section)
  );
}

function validateRecord(repoRoot, record, errors) {
  const { data, path: file, scope, body } = record;
  if (!new Set(["spec", "plan"]).has(data.type)) errors.push(`${file}: type must be spec or plan`);
  if (typeof data.record_id !== "string" || !RECORD_ID.test(data.record_id)) {
    errors.push(`${file}: invalid record_id ${String(data.record_id)}`);
  } else if (data.type === "spec" && !data.record_id.startsWith("SPEC-")) {
    errors.push(`${file}: spec record_id must start with SPEC-`);
  } else if (data.type === "plan" && !data.record_id.startsWith("PLAN-")) {
    errors.push(`${file}: plan record_id must start with PLAN-`);
  }
  for (const key of ["created", "updated"]) {
    if (typeof data[key] !== "string" || !DATE.test(data[key])) {
      errors.push(`${file}: ${key} must be YYYY-MM-DD`);
    }
  }
  for (const key of ["target_milestone", "owner"]) {
    if (typeof data[key] !== "string" || !data[key].trim())
      errors.push(`${file}: ${key} is required`);
  }
  validateDocsImpact(repoRoot, record, errors);
  if (data.type === "plan" && (typeof data.source_spec_id !== "string" || !data.source_spec_id)) {
    errors.push(`${file}: plan requires source_spec_id`);
  }

  const expectedDirectory = data.type === "plan" ? "/plans/" : "/specs/";
  if (!file.includes(expectedDirectory))
    errors.push(`${file}: ${data.type} is in the wrong directory`);

  if (scope === "active") {
    if (!ACTIVE_STATES.has(data.status))
      errors.push(`${file}: active status must be draft, approved, or active`);
    for (const closedKey of [
      "archived_at",
      "outcome",
      "implementation_refs",
      "superseded_by_id",
      "same_change"
    ]) {
      if (data[closedKey] !== undefined)
        errors.push(`${file}: active record cannot set ${closedKey}`);
    }
    return;
  }

  if (data.status !== "archived") errors.push(`${file}: internal record status must be archived`);
  if (typeof data.archived_at !== "string" || !DATE.test(data.archived_at)) {
    errors.push(`${file}: archived_at must be YYYY-MM-DD`);
  }
  if (!ARCHIVE_OUTCOMES.has(data.outcome)) errors.push(`${file}: invalid archive outcome`);
  if (!Array.isArray(data.implementation_refs) || data.implementation_refs.length === 0) {
    errors.push(`${file}: implementation_refs must be a non-empty sequence`);
  } else {
    for (const reference of data.implementation_refs) {
      if (!isImplementationReference(reference)) {
        errors.push(`${file}: invalid implementation reference ${String(reference)}`);
      }
    }
    if (data.implementation_refs.includes("same_change") && data.same_change !== true) {
      errors.push(`${file}: same_change implementation reference requires the same_change flag`);
    }
  }
  if (!/^## Implementation Outcome\s*$/m.test(body)) {
    errors.push(`${file}: archived record requires an Implementation Outcome section`);
  } else if (
    outcomeSection(body)
      .split("\n")
      .filter((line) => line.trim()).length < 7
  ) {
    errors.push(
      `${file}: incomplete Implementation Outcome; expected at least seven content lines`
    );
  }
  if (data.outcome === "superseded") {
    if (typeof data.superseded_by_id !== "string" || !data.superseded_by_id) {
      errors.push(`${file}: superseded outcome requires superseded_by_id`);
    }
  } else if (data.superseded_by_id !== undefined) {
    errors.push(`${file}: superseded_by_id is only valid for superseded outcome`);
  }
  if (data.same_change !== undefined && data.same_change !== true) {
    errors.push(`${file}: same_change may only be set to true`);
  }
  if (data.same_change === true && data.outcome !== "completed") {
    errors.push(`${file}: same_change outcome must be completed`);
  }
}

function markedSection(markdown, name) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const starts = markdown.split(start).length - 1;
  const ends = markdown.split(end).length - 1;
  if (starts !== 1 || ends !== 1) {
    throw new Error(`expected exactly one ${name}:start and ${name}:end marker`);
  }
  const startIndex = markdown.indexOf(start) + start.length;
  const endIndex = markdown.indexOf(end, startIndex);
  if (endIndex < startIndex) throw new Error(`${name}:end appears before ${name}:start`);
  return markdown.slice(startIndex, endIndex);
}

function parseActiveIndex(markdown) {
  const section = markedSection(markdown, "active-records");
  const ids = [];
  for (const line of section.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length === 0) continue;
    const id = cells[0].match(/^`((?:SPEC|PLAN)-[^`]+)`$/)?.[1];
    if (id) ids.push(id);
  }
  return ids;
}

export function checkSuperpowerRecords(repoRoot) {
  const loaded = loadCurrentRecords(repoRoot);
  const errors = [...loaded.errors];
  for (const record of loaded.records) validateRecord(repoRoot, record, errors);

  const byId = new Map();
  for (const record of loaded.records) {
    const id = record.data.record_id;
    if (!id) continue;
    if (byId.has(id))
      errors.push(`duplicate record_id ${id}: ${byId.get(id).path}, ${record.path}`);
    else byId.set(id, record);
  }
  for (const record of loaded.records) {
    if (record.data.type === "plan" && record.data.source_spec_id) {
      const source = byId.get(record.data.source_spec_id);
      if (!source || source.data.type !== "spec") {
        errors.push(
          `${record.path}: source_spec_id does not resolve to a spec: ${record.data.source_spec_id}`
        );
      }
    }
    if (record.data.outcome === "superseded" && record.data.superseded_by_id) {
      if (
        record.data.superseded_by_id === record.data.record_id ||
        !byId.has(record.data.superseded_by_id)
      ) {
        errors.push(`${record.path}: superseded_by_id must resolve to a different record`);
      }
    }
  }

  const indexPath = path.join(repoRoot, "docs/superpowers/README.md");
  if (!existsSync(indexPath)) {
    errors.push("docs/superpowers/README.md is missing");
  } else {
    try {
      const indexed = parseActiveIndex(read(repoRoot, "docs/superpowers/README.md"));
      const duplicateIds = indexed.filter((id, index) => indexed.indexOf(id) !== index);
      if (duplicateIds.length)
        errors.push(
          `active index contains duplicate IDs: ${[...new Set(duplicateIds)].join(", ")}`
        );
      const actual = loaded.records
        .filter((record) => record.scope === "active" && record.data.record_id)
        .map((record) => record.data.record_id)
        .sort();
      const expected = [...new Set(indexed)].sort();
      const missing = actual.filter((id) => !expected.includes(id));
      const stale = expected.filter((id) => !actual.includes(id));
      if (missing.length) errors.push(`active index is missing: ${missing.join(", ")}`);
      if (stale.length)
        errors.push(`active index contains non-active records: ${stale.join(", ")}`);
    } catch (error) {
      errors.push(`docs/superpowers/README.md: ${error.message}`);
    }
  }
  return { errors, records: loaded.records };
}

function tableCells(line) {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim().replace(/^`|`$/g, ""));
}

function parseTable(section, label) {
  const lines = section.split("\n").filter((line) => /^\s*\|/.test(line));
  if (lines.length < 2) throw new Error(`${label} table is missing`);
  const headers = tableCells(lines[0]);
  const separator = tableCells(lines[1]);
  if (
    headers.length === 0 ||
    separator.length !== headers.length ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    throw new Error(`${label} table header is invalid`);
  }
  const rows = lines.slice(2).map((line) => {
    const cells = tableCells(line);
    const values = {};
    for (let index = 0; index < headers.length; index += 1) {
      values[headers[index].toLowerCase()] = cells[index] ?? "";
    }
    return values;
  });
  return { headers: headers.map((header) => header.toLowerCase()), rows };
}

function inventoryTable(markdown, marker) {
  return parseTable(markedSection(markdown, marker), marker);
}

function headingTable(markdown, heading) {
  const match = new RegExp(`^## ${heading}\\s*$`, "m").exec(markdown);
  if (!match) throw new Error(`${heading} heading is missing`);
  const rest = markdown.slice(match.index + match[0].length);
  const nextHeading = /^##\s/m.exec(rest);
  return parseTable(rest.slice(0, nextHeading?.index ?? rest.length), heading);
}

export function checkStatusDocument(markdown) {
  const errors = [];
  const requiredFields = [
    [/^Stage:\s*(?:Pre-alpha|Alpha|Beta|Release candidate|Stable)\s*$/m, "a valid Stage"],
    [/^Release decision:\s*(?:NO-GO|CONDITIONAL|GO)\s*$/m, "a valid Release decision"],
    [/^Snapshot date:\s*\d{4}-\d{2}-\d{2}\s*$/m, "Snapshot date"],
    [/^Verified commit:\s*[0-9a-f]{7,40}\s*$/m, "Verified commit"],
    [/^Next milestone:\s*\S.+$/m, "Next milestone"]
  ];
  for (const [pattern, label] of requiredFields) {
    if (!pattern.test(markdown)) errors.push(`product status is missing ${label}`);
  }
  for (const [marker, idPattern, states, label] of [
    ["capability-inventory", /^CAP-[A-Z0-9-]+$/, CAPABILITY_STATES, "capability"],
    ["issue-inventory", /^(?:ISSUE-[A-Z0-9-]+|P[01]-[A-Z0-9-]+)$/, ISSUE_STATES, "issue"]
  ]) {
    try {
      const table = inventoryTable(markdown, marker);
      for (const required of marker === "issue-inventory"
        ? ["id", "priority", "status", "last verified", "target"]
        : ["id", "status"]) {
        if (!table.headers.includes(required))
          errors.push(`${marker} is missing ${required} column`);
      }
      const rows = table.rows;
      if (rows.length === 0) errors.push(`${marker} has no records`);
      const seen = new Set();
      for (const row of rows) {
        const id = row.id;
        if (!idPattern.test(id)) {
          errors.push(`${marker} contains invalid ${label} ID ${id}`);
          continue;
        }
        if (seen.has(id)) errors.push(`duplicate ${label} ID ${id}`);
        seen.add(id);
        if (!states.has(row.status)) errors.push(`${id} does not contain a legal status in Status`);
        if (marker === "issue-inventory") {
          if (!/^P[01]$/.test(row.priority)) errors.push(`${id} has invalid Priority`);
          if (!DATE.test(row["last verified"])) errors.push(`${id} has invalid Last verified`);
          if (!row.target?.trim()) errors.push(`${id} has an empty Target`);
        }
      }
    } catch (error) {
      errors.push(`docs/product/status.md: ${error.message}`);
    }
  }
  return errors;
}

function issueCoreRows(table) {
  const required = ["id", "priority", "status", "last verified", "target"];
  for (const header of required) {
    if (!table.headers.includes(header))
      throw new Error(`issue inventory is missing ${header} column`);
  }
  const records = new Map();
  for (const row of table.rows) {
    if (!row.id) throw new Error("issue inventory contains an empty ID");
    if (records.has(row.id)) throw new Error(`issue inventory contains duplicate ID ${row.id}`);
    records.set(row.id, {
      priority: row.priority,
      status: row.status,
      last_verified: row["last verified"],
      target: row.target
    });
  }
  return records;
}

export function checkIssueInventoryConsistency(statusMarkdown, readinessMarkdown) {
  const errors = [];
  let statusRows;
  let readinessRows;
  try {
    statusRows = issueCoreRows(inventoryTable(statusMarkdown, "issue-inventory"));
    readinessRows = issueCoreRows(headingTable(readinessMarkdown, "Issue inventory"));
  } catch (error) {
    return [error.message];
  }
  for (const [id, status] of statusRows) {
    const readiness = readinessRows.get(id);
    if (!readiness) {
      errors.push(`${id} is missing from readiness inventory`);
      continue;
    }
    for (const field of ["priority", "status", "last_verified", "target"]) {
      if (status[field] !== readiness[field]) {
        errors.push(`${id} ${field} differs between product status and readiness inventory`);
      }
    }
  }
  for (const id of readinessRows.keys()) {
    if (!statusRows.has(id)) errors.push(`${id} is missing from product status inventory`);
  }
  return errors;
}

export function extractSourceRoutes(source) {
  if (/\bapp\.(?:route|on|all)\s*\(/i.test(source) || /\bapp\s*\[/.test(source)) {
    throw new Error(
      "delegated or dynamic app.route/app.on/app.all registration found; use a route manifest before continuing"
    );
  }
  const callPattern = /\bapp\.(get|post|put|patch|delete)\s*\(/gi;
  const literalPattern = /\bapp\.(get|post|put|patch|delete)\s*\(\s*(["'])([^"'\\\r\n]+)\2\s*,/gi;
  const calls = [...source.matchAll(callPattern)];
  const routes = [...source.matchAll(literalPattern)].map((match) => ({
    method: match[1].toUpperCase(),
    path: match[3]
  }));
  if (calls.length !== routes.length) {
    throw new Error(
      "dynamic or unsupported route registration found; use a route manifest before continuing"
    );
  }
  const seen = new Set();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) throw new Error(`duplicate source route ${key}`);
    seen.add(key);
  }
  return routes;
}

export function parseRouteInventory(markdown) {
  const section = markedSection(markdown, "route-inventory");
  const routes = [];
  for (const line of section.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    if (cells.length < 2 || cells[0].toLowerCase() === "method" || /^:?-{3,}:?$/.test(cells[0]))
      continue;
    const method = cells[0].toUpperCase();
    const routePath = cells[1];
    if (!HTTP_METHODS.has(method) || !routePath.startsWith("/")) {
      throw new Error(`invalid route inventory row: ${line.trim()}`);
    }
    routes.push({ method, path: routePath });
  }
  const keys = routes.map((route) => `${route.method} ${route.path}`);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length)
    throw new Error(`duplicate documented route ${[...new Set(duplicates)].join(", ")}`);
  return routes;
}

export function compareRouteInventories(sourceRoutes, documentedRoutes) {
  const source = new Set(sourceRoutes.map((route) => `${route.method} ${route.path}`));
  const documented = new Set(documentedRoutes.map((route) => `${route.method} ${route.path}`));
  const undocumented = [...source].filter((route) => !documented.has(route)).sort();
  const stale = [...documented].filter((route) => !source.has(route)).sort();
  const errors = [];
  if (undocumented.length) errors.push(`undocumented routes: ${undocumented.join(", ")}`);
  if (stale.length) errors.push(`stale documented routes: ${stale.join(", ")}`);
  return errors;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(glob) {
  const normalized = normalizePath(glob);
  let pattern = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char !== "*") {
      pattern += escapeRegExp(char);
      continue;
    }
    if (normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        pattern += "(?:.*/)?";
      } else {
        pattern += ".*";
      }
    } else {
      pattern += "[^/]*";
    }
  }
  return new RegExp(`^${pattern}$`);
}

function execGitBuffer(repoRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", allowFailure ? "pipe" : "inherit"]
    });
  } catch (error) {
    if (allowFailure && typeof error.status === "number") return null;
    throw new Error(`git ${args[0]} failed: ${error.message}`, { cause: error });
  }
}

function execGit(repoRoot, args, options) {
  const output = execGitBuffer(repoRoot, args, options);
  return output === null ? null : decodeUtf8(output, `git ${args[0]} output`);
}

function resolveMergeBase(repoRoot, base) {
  if (typeof base !== "string" || !base || base.startsWith("-"))
    throw new Error("invalid diff base");
  const verified = execGit(repoRoot, ["rev-parse", "--verify", `${base}^{commit}`], {
    allowFailure: true
  });
  if (!verified) throw new Error(`diff base does not resolve to a commit: ${base}`);
  const mergeBase = execGit(repoRoot, ["merge-base", base, "HEAD"], { allowFailure: true })?.trim();
  if (!mergeBase) throw new Error(`no merge base found for ${base}`);
  return mergeBase;
}

function parseNameStatus(output) {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const changes = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = normalizePath(tokens[index++]);
      const newPath = normalizePath(tokens[index++]);
      changes.push({ status: status[0], oldPath, path: newPath });
    } else {
      const file = normalizePath(tokens[index++]);
      changes.push({ status: status[0], oldPath: file, path: file });
    }
  }
  return changes;
}

function addedAndRemovedLines(diff) {
  const changed = [];
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk && (line.startsWith("+") || line.startsWith("-")) && line.length > 1) {
      changed.push(line.slice(1));
    }
  }
  return changed;
}

export function readGitDiff(repoRoot, base) {
  const mergeBase = resolveMergeBase(repoRoot, base);
  const segments = [
    {
      changes: parseNameStatus(
        execGit(repoRoot, ["diff", "--cached", "--name-status", "-z", "--find-renames", mergeBase])
      ),
      diffArgs: ["--cached", mergeBase]
    },
    {
      changes: parseNameStatus(
        execGit(repoRoot, ["diff", "--name-status", "-z", "--find-renames"])
      ),
      diffArgs: []
    }
  ];
  const changes = [];
  const changeKeys = new Set();
  for (const segment of segments) {
    for (const change of segment.changes) {
      const key = `${change.status}\0${change.oldPath}\0${change.path}`;
      if (!changeKeys.has(key)) {
        changes.push(change);
        changeKeys.add(key);
      }
    }
  }
  const knownPaths = new Set(changes.flatMap((change) => [change.oldPath, change.path]));
  const untracked = execGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .sort();
  for (const file of untracked) {
    if (!knownPaths.has(file)) {
      changes.push({ status: "A", oldPath: file, path: file });
      knownPaths.add(file);
    }
  }
  const changedLineSets = new Map();
  const addChangedLines = (file, lines) => {
    const current = changedLineSets.get(file) ?? new Set();
    for (const line of lines) current.add(line);
    changedLineSets.set(file, current);
  };
  for (const segment of segments) {
    for (const change of segment.changes) {
      const paths = [...new Set([change.oldPath, change.path])];
      const lines = [];
      for (const file of paths) {
        const diff = execGit(repoRoot, [
          "diff",
          "--unified=0",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--text",
          ...segment.diffArgs,
          "--",
          file
        ]);
        lines.push(...addedAndRemovedLines(diff));
      }
      addChangedLines(change.path, lines);
      if (change.oldPath !== change.path) addChangedLines(change.oldPath, lines);
    }
  }
  for (const file of untracked) {
    addChangedLines(
      file,
      read(repoRoot, file).replaceAll("\r\n", "\n").split("\n").filter(Boolean)
    );
  }
  const changedLines = new Map();
  for (const change of changes) {
    const paths = [...new Set([change.oldPath, change.path])];
    const lines = [];
    for (const file of paths) {
      lines.push(...(changedLineSets.get(file) ?? []));
    }
    const unique = [...new Set(lines)];
    changedLines.set(change.path, unique);
    if (change.oldPath !== change.path) changedLines.set(change.oldPath, unique);
  }
  return { mergeBase, changes, changedLines };
}

export function parseDocsImpactComment(body) {
  const declarations = [...body.matchAll(/<!--\s*docs-impact:/g)];
  const matches = [...body.matchAll(/<!--\s*docs-impact:\s*([\s\S]*?)\s*-->/g)];
  if (declarations.length > 1)
    throw new Error("PR body may contain at most one docs-impact declaration");
  if (declarations.length !== matches.length)
    throw new Error("docs-impact declaration is not closed");
  if (matches.length === 0) return null;
  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(`invalid docs-impact JSON: ${error.message}`, { cause: error });
  }
}

function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw new Error("docs-impact rules must be a non-empty array");
  }
  const ids = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule.id !== "string" || !rule.id)
      throw new Error("docs-impact rule requires id");
    if (ids.has(rule.id)) throw new Error(`duplicate docs-impact rule ${rule.id}`);
    ids.add(rule.id);
    if (
      !Array.isArray(rule.paths) ||
      rule.paths.length === 0 ||
      !rule.paths.every((entry) => typeof entry === "string" && entry)
    ) {
      throw new Error(`docs-impact rule ${rule.id} requires non-empty string paths`);
    }
    if (
      !Array.isArray(rule.requireAll) ||
      rule.requireAll.length === 0 ||
      !rule.requireAll.every((entry) => typeof entry === "string" && entry)
    ) {
      throw new Error(`docs-impact rule ${rule.id} requires non-empty string requireAll paths`);
    }
    for (const glob of rule.paths) globToRegExp(glob);
    if (rule.changedLinePattern !== undefined) {
      if (typeof rule.changedLinePattern !== "string") {
        throw new Error(`docs-impact rule ${rule.id} changedLinePattern must be a string`);
      }
      new RegExp(rule.changedLinePattern);
    }
  }
}

export function validateDocsImpactConfig(repoRoot, config) {
  const errors = [];
  if (!config || config.version !== 1) errors.push("docs-impact config version must be 1");
  try {
    validateRules(config?.rules);
  } catch (error) {
    errors.push(error.message);
    return errors;
  }
  for (const rule of config.rules) {
    for (const required of rule.requireAll) {
      if (!required.startsWith("docs/")) {
        errors.push(`docs-impact rule ${rule.id} requireAll must use docs/ paths: ${required}`);
        continue;
      }
      try {
        safeRepoPath(repoRoot, required);
      } catch (error) {
        errors.push(`docs-impact rule ${rule.id} required document ${error.message}`);
      }
    }
  }
  return errors;
}

export function evaluateDocsImpact({ rules, changes, changedLines, declaration }) {
  const errors = [];
  try {
    validateRules(rules);
  } catch (error) {
    return { errors: [error.message], hits: [] };
  }
  const normalizedChanges = changes.map((change) => ({
    ...change,
    oldPath: normalizePath(change.oldPath),
    path: normalizePath(change.path)
  }));
  const hits = [];
  for (const rule of rules) {
    const matchers = rule.paths.map(globToRegExp);
    const matchingChanges = normalizedChanges.filter((change) =>
      [change.oldPath, change.path].some((file) => matchers.some((matcher) => matcher.test(file)))
    );
    if (matchingChanges.length === 0) continue;
    let matchedFiles = matchingChanges.map((change) => change.path);
    if (rule.changedLinePattern) {
      const pattern = new RegExp(rule.changedLinePattern);
      matchedFiles = matchingChanges
        .filter((change) => {
          const lines = changedLines.get(change.path) ?? changedLines.get(change.oldPath) ?? [];
          return lines.some((line) => pattern.test(line));
        })
        .map((change) => change.path);
      if (matchedFiles.length === 0) continue;
    }
    const missing = rule.requireAll.filter(
      (required) =>
        !normalizedChanges.some(
          (change) =>
            change.status !== "D" && normalizePath(change.path) === normalizePath(required)
        )
    );
    hits.push({ rule, matchedFiles: [...new Set(matchedFiles)].sort(), missing });
  }

  const exemptions = new Map();
  if (declaration !== null && declaration !== undefined) {
    if (!declaration || declaration.version !== 1 || !Array.isArray(declaration.exemptions)) {
      errors.push("docs-impact declaration must have version 1 and an exemptions array");
    } else {
      const known = new Set(rules.map((rule) => rule.id));
      const hitIds = new Set(hits.map((hit) => hit.rule.id));
      for (const exemption of declaration.exemptions) {
        const rule = exemption?.rule;
        const reason = exemption?.reason;
        if (typeof rule !== "string" || !known.has(rule)) {
          errors.push(`docs-impact exemption references unknown rule ${String(rule)}`);
          continue;
        }
        if (exemptions.has(rule)) {
          errors.push(`duplicate docs-impact exemption for ${rule}`);
          continue;
        }
        if (!hitIds.has(rule)) errors.push(`docs-impact exemption ${rule} did not match this diff`);
        if (typeof reason !== "string" || [...reason.replace(/\s/gu, "")].length < 20) {
          errors.push(
            `docs-impact exemption ${rule} reason must contain at least 20 non-whitespace characters`
          );
        }
        exemptions.set(rule, reason);
      }
    }
  }
  for (const hit of hits) {
    if (hit.missing.length && !exemptions.has(hit.rule.id)) {
      errors.push(
        `docs-impact rule ${hit.rule.id} matched [${hit.matchedFiles.join(", ")}] but is missing [${hit.missing.join(", ")}]`
      );
    }
  }
  return { errors, hits };
}

function gitFileBuffer(repoRoot, revision, file) {
  const object = `${revision}:${file}`;
  if (execGit(repoRoot, ["cat-file", "-e", object], { allowFailure: true }) === null) return null;
  const content = execGitBuffer(repoRoot, ["show", object]);
  if (content.length > MAX_READ_BYTES) throw new Error(`git blob exceeds 2 MiB: ${file}`);
  return content;
}

function gitFile(repoRoot, revision, file) {
  const content = gitFileBuffer(repoRoot, revision, file);
  return content === null ? null : decodeUtf8(content, `${revision}:${file}`);
}

function loadGitRecords(repoRoot, revision) {
  const output = execGit(repoRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--name-only",
    revision,
    "--",
    "docs/superpowers",
    "docs/internal"
  ]);
  const records = [];
  for (const file of output
    .split("\0")
    .filter(Boolean)
    .map(normalizePath)
    .filter((item) => item.endsWith(".md"))) {
    const active =
      file.startsWith("docs/superpowers/specs/") || file.startsWith("docs/superpowers/plans/");
    const archive =
      /^docs\/internal\/(?:specs|plans)\/[^/]+\.md$/.test(file) &&
      file !== "docs/internal/README.md";
    if (!active && !archive) continue;
    const content = gitFile(repoRoot, revision, file);
    if (!content?.startsWith("---\n")) continue;
    try {
      const parsed = parseFrontMatter(content);
      if (parsed.data.record_id) {
        records.push({ ...parsed, path: file, scope: active ? "active" : "archive" });
      }
    } catch {
      // Static validation reports malformed HEAD records. Historical base records
      // without the controlled schema are handled only through the migration baseline.
    }
  }
  return records;
}

function readMigrationBaseline(repoRoot) {
  const file = path.join(repoRoot, "docs/contracts/superpowers-migration-baseline.json");
  if (!existsSync(file)) return { version: 1, records: [] };
  return JSON.parse(read(repoRoot, "docs/contracts/superpowers-migration-baseline.json"));
}

function validateBaseline(baseline) {
  const errors = [];
  if (!baseline || baseline.version !== 1 || !Array.isArray(baseline.records)) {
    return ["superpowers migration baseline must have version 1 and records array"];
  }
  const paths = new Set();
  const ids = new Set();
  for (const record of baseline.records) {
    if (
      !record ||
      typeof record.sourcePath !== "string" ||
      typeof record.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(record.sha256) ||
      typeof record.recordId !== "string" ||
      !RECORD_ID.test(record.recordId) ||
      !ACTIVE_STATES.has(record.assumedStatus)
    ) {
      errors.push(`invalid migration baseline record ${JSON.stringify(record)}`);
      continue;
    }
    if (!record.sourcePath.startsWith("docs/superpowers/")) {
      errors.push(`migration baseline source is outside active Superpowers: ${record.sourcePath}`);
    }
    if (paths.has(record.sourcePath))
      errors.push(`duplicate migration source ${record.sourcePath}`);
    if (ids.has(record.recordId)) errors.push(`duplicate migration record ID ${record.recordId}`);
    paths.add(record.sourcePath);
    ids.add(record.recordId);
  }
  return errors;
}

function validTransition(previousState, outcome) {
  if (outcome === "completed") return previousState === "active";
  return ACTIVE_STATES.has(previousState) && ["cancelled", "superseded"].includes(outcome);
}

export function checkSuperpowerTransitions(repoRoot, base) {
  const errors = [];
  let mergeBase;
  try {
    mergeBase = resolveMergeBase(repoRoot, base);
  } catch (error) {
    return [error.message];
  }
  const loadedHead = loadCurrentRecords(repoRoot);
  const head = loadedHead.records;
  errors.push(...loadedHead.errors);
  let baseRecords;
  try {
    baseRecords = loadGitRecords(repoRoot, mergeBase);
  } catch (error) {
    return [...errors, `base lifecycle records: ${error.message}`];
  }
  const headById = new Map(
    head.filter((record) => record.data.record_id).map((record) => [record.data.record_id, record])
  );
  const baseById = new Map(
    baseRecords
      .filter((record) => record.data.record_id)
      .map((record) => [record.data.record_id, record])
  );
  let baseline;
  try {
    baseline = readMigrationBaseline(repoRoot);
    errors.push(...validateBaseline(baseline));
  } catch (error) {
    return [`cannot parse superpowers migration baseline: ${error.message}`];
  }

  const baselinePath = "docs/contracts/superpowers-migration-baseline.json";
  const baseBaseline = gitFileBuffer(repoRoot, mergeBase, baselinePath);
  if (baseBaseline !== null) {
    if (!existsSync(path.join(repoRoot, baselinePath))) {
      errors.push(`${baselinePath} is locked and must not be deleted after merge`);
    } else {
      const current = readRepoBuffer(repoRoot, baselinePath);
      if (!current.equals(baseBaseline))
        errors.push(`${baselinePath} is locked and must not change after merge`);
    }
  }
  const migrationById = new Map(
    (baseline.records ?? []).map((record) => [record.recordId, record])
  );

  let lifecycleDiff;
  try {
    lifecycleDiff = readGitDiff(repoRoot, base);
  } catch (error) {
    errors.push(error.message);
    lifecycleDiff = { changes: [] };
  }
  const headPaths = new Set(head.map((record) => record.path));
  for (const change of lifecycleDiff.changes) {
    if (
      change.status !== "D" &&
      /^docs\/internal\/(?:specs|plans)\/[^/]+\.md$/.test(change.path) &&
      !headPaths.has(change.path)
    ) {
      errors.push(`${change.path}: new internal record requires archive metadata`);
    }
  }

  for (const previous of baseRecords.filter((record) => record.scope === "archive")) {
    const current = headById.get(previous.data.record_id);
    if (!current) {
      errors.push(`${previous.path}: existing archive must not be deleted`);
      continue;
    }
    if (current.scope !== "archive") {
      errors.push(`${previous.path}: archived record ${previous.data.record_id} must not reopen`);
      continue;
    }
    if (current.path !== previous.path) {
      errors.push(`${previous.path}: existing archive path is immutable`);
      continue;
    }
    try {
      if (
        !readRepoBuffer(repoRoot, current.path).equals(
          gitFileBuffer(repoRoot, mergeBase, previous.path)
        )
      ) {
        errors.push(`${previous.path}: existing archive is byte-immutable`);
      }
    } catch (error) {
      errors.push(`${previous.path}: existing archive cannot be read: ${error.message}`);
    }
  }

  const newSameChangeSpecs = new Map();
  for (const record of head.filter(
    (item) =>
      item.scope === "archive" &&
      item.data.same_change === true &&
      !baseById.has(item.data.record_id)
  )) {
    const baseRecord = baseById.get(record.data.record_id);
    const baseAtPath = gitFileBuffer(repoRoot, mergeBase, record.path);
    const eligible =
      !baseRecord &&
      baseAtPath === null &&
      record.data.outcome === "completed" &&
      Array.isArray(record.data.implementation_refs) &&
      record.data.implementation_refs.includes("same_change") &&
      hasCompleteSameChangeOutcome(record);
    if (!eligible) {
      errors.push(
        `${record.path}: same_change does not satisfy the restricted closeout requirements`
      );
    } else if (record.data.type === "spec") {
      newSameChangeSpecs.set(record.data.record_id, record);
    }
  }

  for (const record of head.filter((item) => item.scope === "archive")) {
    const id = record.data.record_id;
    if (!id) continue;
    const previous = baseById.get(id);
    if (previous?.scope === "archive") {
      continue;
    }
    if (previous?.scope === "active") {
      if (record.data.same_change === true)
        errors.push(`${record.path}: existing active record cannot use same_change`);
      if (!validTransition(previous.data.status, record.data.outcome)) {
        errors.push(
          `${record.path}: cannot close ${previous.data.status} as ${record.data.outcome}`
        );
      }
      continue;
    }

    const migration = migrationById.get(id);
    if (migration) {
      if (record.data.same_change === true)
        errors.push(`${record.path}: legacy migration cannot use same_change`);
      const source = gitFileBuffer(repoRoot, mergeBase, migration.sourcePath);
      if (source === null) {
        errors.push(
          `${record.path}: migration source is absent from base: ${migration.sourcePath}`
        );
      } else {
        const hash = createHash("sha256").update(source).digest("hex");
        if (hash !== migration.sha256) {
          errors.push(
            `${record.path}: migration source SHA-256 mismatch for ${migration.sourcePath}`
          );
        }
      }
      if (!validTransition(migration.assumedStatus, record.data.outcome)) {
        errors.push(
          `${record.path}: cannot close assumed ${migration.assumedStatus} as ${record.data.outcome}`
        );
      }
      continue;
    }

    if (record.data.same_change === true) {
      if (record.data.type === "plan" && !newSameChangeSpecs.has(record.data.source_spec_id)) {
        errors.push(
          `${record.path}: same-change plan source_spec_id must resolve to a same-change archived spec`
        );
      }
      continue;
    }
    errors.push(
      `${record.path}: archived record ${id} has no active base record or migration entry`
    );
  }

  for (const previous of baseRecords.filter((record) => record.scope === "active")) {
    const current = headById.get(previous.data.record_id);
    if (!current) {
      errors.push(`${previous.path}: active base record disappeared without a matching archive`);
      continue;
    }
    if (current.scope === "active") {
      const from = previous.data.status;
      const to = current.data.status;
      const allowed =
        from === to ||
        (from === "draft" && to === "approved") ||
        (from === "approved" && to === "active");
      if (!allowed)
        errors.push(`${current.path}: invalid active state transition ${from} -> ${to}`);
    }
  }
  return errors;
}

export function checkAgentSymlink(repoRoot) {
  const errors = [];
  const agents = path.join(repoRoot, "AGENTS.md");
  const claude = path.join(repoRoot, "CLAUDE.md");
  if (!existsSync(agents)) errors.push("AGENTS.md does not exist");
  if (!existsSync(claude)) {
    errors.push("CLAUDE.md does not exist");
    return errors;
  }
  if (!lstatSync(claude).isSymbolicLink()) {
    errors.push("CLAUDE.md must be a symbolic link");
  } else if (readlinkSync(claude) !== "AGENTS.md") {
    errors.push(`CLAUDE.md symlink target must be AGENTS.md, got ${readlinkSync(claude)}`);
  }
  const index = execGit(repoRoot, ["ls-files", "-s", "--", "CLAUDE.md"], {
    allowFailure: true
  });
  if (!index || !/^120000 [0-9a-f]+ 0\tCLAUDE\.md\n?$/.test(index)) {
    errors.push("Git index mode for CLAUDE.md must be 120000");
  } else {
    const target = execGit(repoRoot, ["show", ":CLAUDE.md"], { allowFailure: true });
    if (target !== "AGENTS.md") errors.push("Git index CLAUDE.md target must be exactly AGENTS.md");
  }
  return errors;
}

export function loadDocsImpactDeclaration({
  declarationPath,
  githubEventPath,
  requireFreshApproval = false
} = {}) {
  if (declarationPath && githubEventPath) {
    throw new Error("--declaration and --github-event are mutually exclusive");
  }
  if (declarationPath) return JSON.parse(readTrustedFile(declarationPath));
  if (githubEventPath) {
    const event = JSON.parse(readTrustedFile(githubEventPath));
    const declaration = parseDocsImpactComment(event?.pull_request?.body ?? "");
    const exemptions = declaration?.exemptions;
    const labels = event?.pull_request?.labels ?? [];
    const approved = labels.some((label) =>
      typeof label === "string"
        ? label === "docs-impact-approved"
        : label?.name === "docs-impact-approved"
    );
    if (Array.isArray(exemptions) && exemptions.length > 0 && !approved) {
      throw new Error("GitHub-event exemptions require the docs-impact-approved label");
    }
    if (
      Array.isArray(exemptions) &&
      exemptions.length > 0 &&
      requireFreshApproval &&
      (event?.action !== "labeled" || event?.label?.name !== "docs-impact-approved")
    ) {
      throw new Error(
        "GitHub-event exemptions require fresh docs-impact approval for the latest PR head"
      );
    }
    return declaration;
  }
  return null;
}

export function parseDocsCheckArgs(argv) {
  const options = { base: null, declarationPath: null, githubEventPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (!["--base", "--declaration", "--github-event"].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === "--base") options.base = value;
    if (argument === "--declaration") options.declarationPath = value;
    if (argument === "--github-event") options.githubEventPath = value;
  }
  if ((options.declarationPath || options.githubEventPath) && !options.base) {
    throw new Error("--declaration and --github-event require --base");
  }
  if (options.declarationPath && options.githubEventPath) {
    throw new Error("--declaration and --github-event are mutually exclusive");
  }
  return options;
}

export function runStaticChecks(repoRoot) {
  const errors = [];
  const files = collectMarkdownFiles(repoRoot);
  errors.push(...checkMarkdownLinks(repoRoot, files));
  errors.push(...checkCodeReferences(repoRoot, files));
  errors.push(...checkPnpmScripts(repoRoot, files));
  errors.push(...checkAgentReferences(repoRoot));
  errors.push(...checkSuperpowerRecords(repoRoot).errors);
  let statusMarkdown = null;
  try {
    statusMarkdown = read(repoRoot, "docs/product/status.md");
    errors.push(...checkStatusDocument(statusMarkdown));
  } catch (error) {
    errors.push(`docs/product/status.md: ${error.message}`);
  }
  try {
    const readiness = read(repoRoot, "docs/developer/issues/2026-07-11-product-readiness-audit.md");
    if (statusMarkdown) errors.push(...checkIssueInventoryConsistency(statusMarkdown, readiness));
  } catch (error) {
    errors.push(`readiness inventory: ${error.message}`);
  }
  try {
    const config = JSON.parse(read(repoRoot, "docs/contracts/docs-impact.json"));
    errors.push(...validateDocsImpactConfig(repoRoot, config));
  } catch (error) {
    errors.push(`docs-impact config: ${error.message}`);
  }
  try {
    const sourceRoutes = extractSourceRoutes(read(repoRoot, "apps/pi-server/src/app.ts"));
    const inventory = parseRouteInventory(read(repoRoot, "docs/developer/api.md"));
    errors.push(...compareRouteInventories(sourceRoutes, inventory));
  } catch (error) {
    errors.push(`route inventory: ${error.message}`);
  }
  try {
    errors.push(...validateBaseline(readMigrationBaseline(repoRoot)));
  } catch (error) {
    errors.push(`migration baseline: ${error.message}`);
  }
  errors.push(...checkAgentSymlink(repoRoot));
  return errors;
}

export function runDiffChecks(
  repoRoot,
  base,
  declaration = null,
  { impactConfigPath = null } = {}
) {
  const errors = [];
  let diff;
  try {
    diff = readGitDiff(repoRoot, base);
  } catch (error) {
    return [error.message];
  }
  try {
    const config = JSON.parse(
      impactConfigPath
        ? readTrustedFile(impactConfigPath)
        : read(repoRoot, "docs/contracts/docs-impact.json")
    );
    const configErrors = validateDocsImpactConfig(repoRoot, config);
    errors.push(...configErrors);
    if (configErrors.length === 0) {
      errors.push(
        ...evaluateDocsImpact({
          rules: config.rules,
          changes: diff.changes,
          changedLines: diff.changedLines,
          declaration
        }).errors
      );
    }
  } catch (error) {
    errors.push(`docs-impact config: ${error.message}`);
  }
  errors.push(...checkSuperpowerTransitions(repoRoot, base));
  return errors;
}
