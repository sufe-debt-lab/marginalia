import fs from "node:fs";
import {
  parseSessionEntries,
  type FileEntry,
  type SessionMessageEntry
} from "@earendil-works/pi-coding-agent";
import type { ChatEntry, PiMessageCore } from "@marginalia/chat-core";

export type { ChatEntry } from "@marginalia/chat-core";

type SessionMessage = SessionMessageEntry["message"];

function isSessionMessageEntry(entry: FileEntry): entry is SessionMessageEntry {
  return entry.type === "message";
}

function isPiMessageCore(message: SessionMessage): message is PiMessageCore {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

export function readMessagesFromSessionFile(filePath: string): ChatEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const fileEntries = parseSessionEntries(raw);
  const result: ChatEntry[] = [];
  for (const entry of fileEntries) {
    if (!isSessionMessageEntry(entry)) continue;
    const { id, message: sessionMessage } = entry;
    if (!isPiMessageCore(sessionMessage)) continue;
    result.push({ id, message: sessionMessage });
  }
  return result;
}
