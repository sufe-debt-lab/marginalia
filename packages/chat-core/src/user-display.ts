export type UserDisplay = {
  text: string;
  skillNames: readonly string[];
};

const SKILL_OPEN = /^<skill name="([^"\r\n]*)" location="([^"\r\n]*)">\n/;
const SKILL_CLOSE = "\n</skill>";
const ATTACHMENT_SUFFIX = "\n\n<attached_files>\n";
const ATTACHMENT_CLOSE = "\n</attached_files>";
const ATTACHED_FILE_OPEN = /^<attached_file path="([^"\r\n]*)" (mime|error)="([^"\r\n]*)">\n/;
const ATTACHED_FILE_CLOSE = "\n</attached_file>";
const EMPTY_ATTACHED_FILE_CLOSE = "</attached_file>";

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&apos;": "'"
};

const ATTACHMENT_XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">"
};

function decodeSkillXmlAttribute(value: string): string | null {
  if (/&(?!(?:amp|quot|lt|gt|apos);)/.test(value)) return null;
  return value.replace(/&(amp|quot|lt|gt|apos);/g, (entity) => XML_ENTITIES[entity]!);
}

function decodeAttachmentXmlAttribute(value: string): string | null {
  if (/&(?!(?:amp|quot|lt|gt);)/.test(value)) return null;
  return value.replace(/&(amp|quot|lt|gt);/g, (entity) => ATTACHMENT_XML_ENTITIES[entity]!);
}

function parseLeadingSkills(raw: string): { names: string[]; rest: string } | null {
  let rest = raw;
  const names: string[] = [];
  while (rest.startsWith("<skill")) {
    const open = SKILL_OPEN.exec(rest);
    if (!open) return null;
    const closeAt = rest.indexOf(SKILL_CLOSE, open[0].length);
    if (closeAt < 0) return null;
    const name = decodeSkillXmlAttribute(open[1]!);
    const location = decodeSkillXmlAttribute(open[2]!);
    if (name === null || location === null) return null;
    names.push(name);
    rest = rest.slice(closeAt + SKILL_CLOSE.length);
    if (rest === "") break;
    if (!rest.startsWith("\n\n")) return null;
    rest = rest.slice(2);
    if (!rest.startsWith("<skill")) break;
  }
  return names.length > 0 ? { names, rest } : { names: [], rest: raw };
}

function isGeneratedAttachmentEnvelope(value: string): boolean {
  if (!value.startsWith("<attached_files>\n") || !value.endsWith(ATTACHMENT_CLOSE)) {
    return false;
  }

  let rest = value.slice("<attached_files>\n".length, -ATTACHMENT_CLOSE.length);
  let count = 0;
  while (rest !== "") {
    const open = ATTACHED_FILE_OPEN.exec(rest);
    if (!open) return false;
    if (
      decodeAttachmentXmlAttribute(open[1]!) === null ||
      decodeAttachmentXmlAttribute(open[3]!) === null
    ) {
      return false;
    }
    const variant = open[2]!;
    const closeAt =
      variant === "error"
        ? rest.startsWith(EMPTY_ATTACHED_FILE_CLOSE, open[0].length)
          ? open[0].length
          : -1
        : rest.indexOf(ATTACHED_FILE_CLOSE, open[0].length);
    if (closeAt < 0) return false;
    count += 1;
    rest = rest.slice(
      closeAt +
        (variant === "error" ? EMPTY_ATTACHED_FILE_CLOSE.length : ATTACHED_FILE_CLOSE.length)
    );
    if (rest === "") break;
    if (!rest.startsWith("\n<attached_file ")) return false;
    rest = rest.slice(1);
  }
  return count > 0;
}

function stripGeneratedAttachmentSuffix(text: string): string {
  const suffixAt = text.lastIndexOf(ATTACHMENT_SUFFIX);
  if (suffixAt < 0) return text;
  const envelope = text.slice(suffixAt + 2);
  return isGeneratedAttachmentEnvelope(envelope) ? text.slice(0, suffixAt) : text;
}

export function formatUserDisplayText(text: string, skillNames: readonly string[]): string {
  const markers = skillNames.map((name) => `$${name}`).join(" ");
  if (!markers) return text;
  return text ? `${markers}\n\n${text}` : markers;
}

export function normalizeAgentPromptForDisplay(raw: string): UserDisplay {
  const parsed = parseLeadingSkills(raw);
  if (parsed === null) return { skillNames: [], text: raw };
  if (parsed.names.length > 0 && parsed.rest.includes(SKILL_CLOSE)) {
    return { skillNames: [], text: raw };
  }
  const text = stripGeneratedAttachmentSuffix(parsed.rest);
  return {
    skillNames: parsed.names,
    text: formatUserDisplayText(text, parsed.names)
  };
}
