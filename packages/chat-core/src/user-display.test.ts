import { describe, expect, it } from "vitest";
import { formatUserDisplayText, normalizeAgentPromptForDisplay } from "./user-display.js";

const skill = (name: string, location: string, body = "Instructions") =>
  `<skill name="${name}" location="${location}">\n${body}\n</skill>`;

const attachment =
  '<attached_files>\n<attached_file path="note.md" mime="text/markdown">\n# Note\ncontext\n</attached_file>\n</attached_files>';

const attachmentEnvelope = (...blocks: string[]) =>
  `<attached_files>\n${blocks.join("\n")}\n</attached_files>`;

const mimeAttachment = (body: string) =>
  `<attached_file path="note.md" mime="text/markdown">\n${body}\n</attached_file>`;

const errorAttachment =
  '<attached_file path="missing.md" error="File &quot;missing.md&quot; is unavailable">\n</attached_file>';

describe("formatUserDisplayText", () => {
  it("places ordered Skill markers before user text", () => {
    expect(formatUserDisplayText("Review this document", ["brainstorming", "pdf"])).toBe(
      "$brainstorming $pdf\n\nReview this document"
    );
  });

  it("returns only markers when user text is empty", () => {
    expect(formatUserDisplayText("", ["brainstorming"])).toBe("$brainstorming");
  });

  it("returns user text unchanged without Skill markers", () => {
    expect(formatUserDisplayText("ordinary text", [])).toBe("ordinary text");
  });
});

describe("normalizeAgentPromptForDisplay", () => {
  it("leaves ordinary user text unchanged", () => {
    expect(normalizeAgentPromptForDisplay("Review this document")).toEqual({
      skillNames: [],
      text: "Review this document"
    });
  });

  it("extracts one leading Skill without consulting its location", () => {
    const raw = `${skill("deleted-skill", "/deleted/SKILL.md")}\n\nhello`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({
      skillNames: ["deleted-skill"],
      text: "$deleted-skill\n\nhello"
    });
  });

  it("extracts multiple leading Skills in order", () => {
    const raw =
      `${skill("brainstorming", "/skills/brainstorming/SKILL.md")}\n\n` +
      `${skill("pdf", "/skills/pdf/SKILL.md")}\n\nReview this document`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({
      skillNames: ["brainstorming", "pdf"],
      text: "$brainstorming $pdf\n\nReview this document"
    });
  });

  it("decodes exactly the five XML attribute entities", () => {
    const raw = `${skill(
      "a&amp;&quot;&lt;&gt;&apos;b",
      "/a&amp;&quot;&lt;&gt;&apos;b/SKILL.md"
    )}\n\nhello`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({
      skillNames: [`a&"<>'b`],
      text: `$a&"<>'b\n\nhello`
    });
  });

  it.each([
    ["name", skill("bad&#39;name", "/skills/bad/SKILL.md")],
    ["location", skill("bad", "/skills/bad&nbsp;path/SKILL.md")],
    ["bare ampersand", skill("bad&name", "/skills/bad/SKILL.md")]
  ])("fails closed for an unsupported entity in the %s attribute", (_case, block) => {
    const raw = `${block}\n\nhello\n\n${attachment}`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({ skillNames: [], text: raw });
  });

  it("removes a complete generated attachment envelope after Skill parsing", () => {
    const raw = `${skill("pdf", "/skills/pdf/SKILL.md")}\n\nReview this document\n\n${attachment}`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({
      skillNames: ["pdf"],
      text: "$pdf\n\nReview this document"
    });
  });

  it("removes a complete generated attachment envelope without Skills", () => {
    expect(normalizeAgentPromptForDisplay(`Review this document\n\n${attachment}`)).toEqual({
      skillNames: [],
      text: "Review this document"
    });
  });

  it("supports generated unreadable-attachment entries", () => {
    const envelope = attachmentEnvelope(errorAttachment);

    expect(normalizeAgentPromptForDisplay(`inspect\n\n${envelope}`)).toEqual({
      skillNames: [],
      text: "inspect"
    });
  });

  it("supports a generated mime attachment with an empty body", () => {
    const envelope = attachmentEnvelope(mimeAttachment(""));

    expect(normalizeAgentPromptForDisplay(`inspect\n\n${envelope}`)).toEqual({
      skillNames: [],
      text: "inspect"
    });
  });

  it("removes multiple generated mime and error attachments", () => {
    const envelope = attachmentEnvelope(
      mimeAttachment("context"),
      errorAttachment,
      '<attached_file path="data&amp;&quot;&lt;&gt;.txt" mime="text/plain">\nbody\n</attached_file>'
    );

    expect(normalizeAgentPromptForDisplay(`inspect\n\n${envelope}`)).toEqual({
      skillNames: [],
      text: "inspect"
    });
  });

  it.each([
    [
      "mime attachment with an immediate close",
      '<attached_file path="note.md" mime="text/markdown">\n</attached_file>'
    ],
    [
      "error attachment with a body",
      '<attached_file path="missing.md" error="unavailable">\nreason\n</attached_file>'
    ],
    [
      "attachment attribute with apos entity",
      '<attached_file path="note&apos;.md" mime="text/markdown">\ncontext\n</attached_file>'
    ]
  ])("retains the whole suffix for a malformed %s", (_case, block) => {
    const envelope = attachmentEnvelope(block);
    const raw = `inspect\n\n${envelope}`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({ skillNames: [], text: raw });
  });

  it("retains a malformed attachment suffix while still formatting valid Skills", () => {
    const malformed =
      '<attached_files>\n<attached_file path="note.md" mime="text/markdown">\ncontext\n</attached_files>';
    const raw = `${skill("pdf", "/skills/pdf/SKILL.md")}\n\nReview\n\n${malformed}`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({
      skillNames: ["pdf"],
      text: `$pdf\n\nReview\n\n${malformed}`
    });
  });

  it("fails closed for a malformed leading Skill and does not strip attachments", () => {
    const raw = `<skill broken\n\nhello\n\n${attachment}`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({ skillNames: [], text: raw });
  });

  it("fails closed when a leading Skill is not followed by the required separator", () => {
    const raw = `${skill("pdf", "/skills/pdf/SKILL.md")}\nhello`;

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({ skillNames: [], text: raw });
  });

  it("fails closed when a Skill body contains an ambiguous closing tag", () => {
    const raw = skill(
      "ambiguous",
      "/skills/ambiguous/SKILL.md",
      "Before\n</skill>\nbody continues"
    );

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({ skillNames: [], text: raw });
  });

  it("fails closed when a false body closing tag looks like the block boundary", () => {
    const raw = skill(
      "ambiguous",
      "/skills/ambiguous/SKILL.md",
      "Before\n</skill>\n\nbody continues"
    );

    expect(normalizeAgentPromptForDisplay(raw)).toEqual({ skillNames: [], text: raw });
  });
});
