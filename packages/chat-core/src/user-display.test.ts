import { describe, expect, it } from "vitest";
import { formatUserDisplayText, normalizeAgentPromptForDisplay } from "./user-display.js";

const skill = (name: string, location: string, body = "Instructions") =>
  `<skill name="${name}" location="${location}">\n${body}\n</skill>`;

const attachment =
  '<attached_files>\n<attached_file path="note.md" mime="text/markdown">\n# Note\ncontext\n</attached_file>\n</attached_files>';

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
    const errorAttachment =
      '<attached_files>\n<attached_file path="missing.md" error="File &quot;missing.md&quot; is unavailable">\n</attached_file>\n</attached_files>';

    expect(normalizeAgentPromptForDisplay(`inspect\n\n${errorAttachment}`)).toEqual({
      skillNames: [],
      text: "inspect"
    });
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
