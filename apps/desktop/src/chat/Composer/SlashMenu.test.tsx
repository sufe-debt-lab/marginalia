import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillPickerItem } from "@/hooks/useSkillCatalog.js";
import { SlashMenu } from "./SlashMenu.js";

afterEach(() => cleanup());

describe("SlashMenu", () => {
  const skills: SkillPickerItem[] = [
    {
      name: "skills",
      description: "Inspect ordinary Skill content",
      canonicalPath: "/skills/skills/SKILL.md",
      source: "user_agents",
      explicitOnly: false,
      diagnostics: []
    }
  ];

  it("bounds the upward menu so both section headings stay visible in New chat", () => {
    render(
      <SlashMenu
        query=""
        skills={skills}
        skillsLoading={false}
        skillsError={null}
        onSelect={vi.fn()}
        onRetrySkills={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("listbox", { name: "Commands and Skills" })).toHaveClass(
      "max-h-[190px]"
    );
  });

  it("filters by query and selects with click", async () => {
    const onSelect = vi.fn();
    render(
      <SlashMenu
        query="cle"
        skills={skills}
        skillsLoading={false}
        skillsError={null}
        onSelect={onSelect}
        onRetrySkills={vi.fn()}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.queryByText("/help")).toBeNull();
    await userEvent.click(screen.getByText("/clear"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "command", name: "clear" })
    );
  });

  it("renders Commands and Skills sections but navigates only selectable rows", async () => {
    const onSelect = vi.fn();
    render(
      <SlashMenu
        query=""
        skills={skills}
        skillsLoading={false}
        skillsError={null}
        onSelect={onSelect}
        onRetrySkills={vi.fn()}
        onClose={() => {}}
      />
    );

    expect(screen.getByRole("listbox", { name: "Commands and Skills" })).toBeInTheDocument();
    expect(screen.getByText("Commands")).toBeInTheDocument();
    expect(screen.getByText("Skills")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(onSelect).toHaveBeenCalledWith({
      kind: "skill",
      key: skills[0]!.canonicalPath,
      skill: skills[0]
    });
  });

  it("does not create a /skills management command", () => {
    render(
      <SlashMenu
        query="skills"
        skills={skills}
        skillsLoading={false}
        skillsError={null}
        onSelect={vi.fn()}
        onRetrySkills={vi.fn()}
        onClose={() => {}}
      />
    );

    expect(screen.queryByText("/skills")).not.toBeInTheDocument();
    expect(screen.getByText("$skills")).toBeInTheDocument();
    expect(screen.getByText("Skill")).toBeInTheDocument();
  });

  it("keeps commands available but hides stale Skill rows after refresh failure", async () => {
    const onRetry = vi.fn();
    render(
      <SlashMenu
        query=""
        skills={skills}
        skillsLoading={false}
        skillsError={new Error("offline")}
        onSelect={vi.fn()}
        onRetrySkills={onRetry}
        onClose={() => {}}
      />
    );

    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.queryByText("$skills")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
