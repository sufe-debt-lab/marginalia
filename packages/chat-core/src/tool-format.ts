/**
 * Pure formatting helpers shared by the desktop chat UI and pi-server, so the
 * same projection of pi tool/message payloads is used live and on session reopen.
 */

/** Flatten pi message content (string or array of text/typed parts) into plain text. */
export function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      const candidate = part as { type?: string; text?: unknown };
      if (candidate.type === "text" && typeof candidate.text === "string") return candidate.text;
      return "";
    })
    .join("");
}

/** A compact, human-readable argument pulled from a pi tool call's args. */
export function toolSubtitle(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  const candidate = a.path ?? a.file_path ?? a.filePath ?? a.command ?? a.pattern ?? a.query;
  return typeof candidate === "string" ? candidate : undefined;
}

/** A short, display-ready string for a tool result (truncated to 400 chars). */
export function resultText(result: unknown): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") return result.slice(0, 400);
  if (typeof result !== "object") return String(result);
  const record = result as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const candidate = part as { text?: unknown };
          return typeof candidate.text === "string" ? candidate.text : "";
        }
        return "";
      })
      .join("");
    if (text) return text.slice(0, 400);
  }
  try {
    return JSON.stringify(result).slice(0, 400);
  } catch {
    return undefined;
  }
}
