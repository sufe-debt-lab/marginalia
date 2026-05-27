import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "./path-sandbox.js";

export type DocumentContent = {
  path: string;
  mime: string;
  text: string;
  pages?: number;
  truncated: boolean;
};

const maxTextLength = 80_000;

export async function readDocument(rootDir: string, relativePath: string): Promise<DocumentContent> {
  const absolute = resolveWorkspacePath(rootDir, relativePath);
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".pdf") {
    const buffer = readFileSync(absolute);
    const text = buffer.toString("utf8");
    return truncate({ path: relativePath, mime: "application/pdf", text, pages: 1, truncated: false });
  }

  const mime = extension === ".md" ? "text/markdown" : "text/plain";
  return truncate({ path: relativePath, mime, text: readFileSync(absolute, "utf8"), truncated: false });
}

function truncate(content: DocumentContent): DocumentContent {
  if (content.text.length <= maxTextLength) return content;
  return { ...content, text: content.text.slice(0, maxTextLength), truncated: true };
}
