import { readDocument } from "../files/document-reader.js";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

export async function buildAgentMessage(input: {
  workspaceRoot: string;
  text: string;
  contextFiles: readonly string[];
  skillBlocks?: readonly string[];
}): Promise<string> {
  const skillPrefix = input.skillBlocks?.length ? `${input.skillBlocks.join("\n\n")}\n\n` : "";
  const message = `${skillPrefix}${input.text}`;
  const unique = [...new Set(input.contextFiles.map((file) => file.trim()).filter(Boolean))];
  if (unique.length === 0) return message;

  const attachments: string[] = [];
  for (const filePath of unique) {
    try {
      const document = await readDocument(input.workspaceRoot, filePath);
      const text = document.rawOnly
        ? `[${document.mime} attachment; content preview unavailable. Use file tools if you need to inspect it.]`
        : document.text;
      attachments.push(
        `<attached_file path="${escapeAttr(filePath)}" mime="${escapeAttr(document.mime)}">\n${text}\n</attached_file>`
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unavailable";
      attachments.push(
        `<attached_file path="${escapeAttr(filePath)}" error="${escapeAttr(reason)}">\n</attached_file>`
      );
    }
  }

  return `${message}\n\n<attached_files>\n${attachments.join("\n")}\n</attached_files>`;
}
