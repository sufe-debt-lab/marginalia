import type { FileHandle } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { WorkspaceFiles } from "./workspace-files.js";

export type DocumentContent = {
  path: string;
  mime: string;
  text: string;
  language: string;
  lineCount: number;
  lineCountExact: boolean;
  truncated: boolean;
  bytesRead: number;
  bytesTotal: number;
  rawOnly?: boolean;
};

export type DocumentPreviewErrorCode =
  | "not_found"
  | "not_a_file"
  | "file_too_large"
  | "binary_not_previewable"
  | "read_failed";

export class DocumentPreviewError extends Error {
  constructor(
    public readonly code: DocumentPreviewErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DocumentPreviewError";
  }
}

const byteCeiling = 10 * 1024 * 1024;
const binaryDetectionSample = 4096;
const absoluteLineCeiling = 100_000;
const defaultLineCap = 1000;

const extensionLineCaps: Record<string, number> = {
  md: 50_000,
  mdx: 50_000,
  txt: 50_000,
  log: 10_000,
  csv: 10_000,
  tsv: 10_000
};

export const mimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xml": "text/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".jsx": "application/javascript",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".py": "text/x-python",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".java": "text/x-java",
  ".rb": "text/x-ruby",
  ".sh": "text/x-shellscript",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/toml",
  ".sql": "text/x-sql"
};

const languageMap: Record<string, string> = {
  md: "markdown",
  mdx: "markdown",
  txt: "plaintext",
  log: "plaintext",
  csv: "csv",
  tsv: "tsv",
  json: "json",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  sh: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  sql: "sql",
  pdf: "pdf",
  doc: "word",
  docx: "word",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation"
};

export const rawOnlyExtensions = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".bmp",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".mov",
  ".webm",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx"
]);

/** Extensions worth surfacing in the file tree — every type we know a mime for. */
export const readableExtensions = new Set(Object.keys(mimeTypes));
/** Readable extensions whose contents are plain text (i.e. content-searchable). */
export const textExtensions = new Set(
  [...readableExtensions].filter((ext) => !rawOnlyExtensions.has(ext))
);

export function mimeFromPath(filePath: string): string {
  return mimeTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Maps a preview error code to its HTTP status. Exhaustive — new codes fail typecheck. */
export function previewErrorStatus(code: DocumentPreviewErrorCode) {
  switch (code) {
    case "not_found":
      return 404;
    case "not_a_file":
      return 400;
    case "file_too_large":
      return 413;
    case "binary_not_previewable":
      return 415;
    case "read_failed":
      return 500;
  }
}

export async function readDocument(
  rootDir: string,
  relativePath: string
): Promise<DocumentContent> {
  const files = await WorkspaceFiles.open(rootDir);
  files.relative(relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  const bareExt = extension.slice(1);
  let stat;
  try {
    stat = await files.stat(relativePath);
  } catch {
    throw new DocumentPreviewError("not_found", `File not found: ${relativePath}`);
  }
  if (!stat.isFile) {
    throw new DocumentPreviewError("not_a_file", `Not a file: ${relativePath}`);
  }

  const bytesTotal = stat.size;
  const language = languageMap[bareExt] ?? "plaintext";
  const mime = mimeTypes[extension] ?? "application/octet-stream";

  if (rawOnlyExtensions.has(extension)) {
    return {
      path: relativePath,
      mime,
      text: "",
      language,
      lineCount: 0,
      lineCountExact: true,
      truncated: false,
      bytesRead: 0,
      bytesTotal,
      rawOnly: true
    };
  }

  if (bytesTotal > byteCeiling) {
    throw new DocumentPreviewError(
      "file_too_large",
      `File too large to preview: ${bytesTotal} bytes`,
      { bytesTotal, byteLimit: byteCeiling }
    );
  }

  const opened = await files.openRead(relativePath);
  try {
    if (opened.stat.size > byteCeiling)
      throw new DocumentPreviewError("file_too_large", "File too large to preview");
    await assertTextPreviewable(opened.handle, opened.stat.size, relativePath);
    const maxLines = Math.min(extensionLineCaps[bareExt] ?? defaultLineCap, absoluteLineCeiling);
    return await readTextPreview(
      opened.handle,
      relativePath,
      mime,
      language,
      opened.stat.size,
      maxLines
    );
  } finally {
    await opened.handle.close();
  }
}

async function assertTextPreviewable(handle: FileHandle, bytesTotal: number, relativePath: string) {
  try {
    const sampleSize = Math.min(binaryDetectionSample, bytesTotal);
    const sample = Buffer.alloc(sampleSize);
    await handle.read(sample, 0, sampleSize, 0);
    if (looksBinary(sample)) {
      throw new DocumentPreviewError(
        "binary_not_previewable",
        `Binary file cannot be previewed: ${relativePath}`,
        { bytesTotal }
      );
    }
  } catch (error) {
    if (error instanceof DocumentPreviewError) throw error;
    throw new DocumentPreviewError("read_failed", `Failed to sample file: ${String(error)}`);
  }
}

async function readTextPreview(
  handle: FileHandle,
  relativePath: string,
  mime: string,
  language: string,
  bytesTotal: number,
  maxLines: number
): Promise<DocumentContent> {
  const collectedLines: string[] = [];
  let scannedLineCount = 0;
  let hitLimit = false;

  await new Promise<void>((resolve, reject) => {
    const stream = handle.createReadStream({ encoding: "utf8", autoClose: false, start: 0 });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      scannedLineCount++;
      if (collectedLines.length < maxLines) {
        collectedLines.push(line);
      } else {
        hitLimit = true;
        rl.close();
        stream.destroy();
      }
    });
    rl.on("close", () => resolve());
    rl.on("error", reject);
    stream.on("error", reject);
  });

  const text = collectedLines.join("\n");
  const estimatedTotalLines = Math.max(1, Math.ceil(bytesTotal / 60));
  const lineCount = hitLimit ? Math.max(scannedLineCount, estimatedTotalLines) : scannedLineCount;

  return {
    path: relativePath,
    mime,
    text,
    language,
    lineCount,
    lineCountExact: !hitLimit,
    truncated: hitLimit,
    bytesRead: Buffer.byteLength(text, "utf8"),
    bytesTotal
  };
}

function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nonText = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === undefined) continue;
    if (b === 0) return true;
    if (b === 9 || b === 10 || b === 12 || b === 13 || (b >= 32 && b <= 126)) continue;
    if (b >= 128) continue;
    nonText++;
  }
  return nonText / buf.length > 0.3;
}
