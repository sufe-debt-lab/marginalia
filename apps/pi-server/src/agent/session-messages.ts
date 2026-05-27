import fs from "node:fs";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

function stringifyContent(content: unknown): string {
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

export function readMessagesFromSessionFile(filePath: string): UiMessage[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const fileEntries = parseSessionEntries(raw);
  const result: UiMessage[] = [];
  for (const entry of fileEntries) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: string }).type !== "message") continue;
    const msgEntry = entry as { id?: string; message?: { role?: string; content?: unknown } };
    const role = msgEntry.message?.role;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    const id = msgEntry.id;
    if (!id) continue;
    result.push({ id, role, content: stringifyContent(msgEntry.message?.content) });
  }
  return result;
}
