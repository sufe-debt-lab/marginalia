import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillPickerItem } from "@/hooks/useSkillCatalog.js";
import { SkillMenu } from "./SkillMenu.js";

afterEach(() => cleanup());

const skills: SkillPickerItem[] = [
  {
    name: "pdf",
    description: "Review portable documents",
    canonicalPath: "/skills/pdf/SKILL.md",
    source: "user_agents",
    explicitOnly: false,
    diagnostics: []
  },
  {
    name: "brainstorming",
    description: "Explore product ideas",
    canonicalPath: "/skills/brainstorming/SKILL.md",
    source: "workspace_marginalia",
    explicitOnly: true,
    diagnostics: []
  }
];

describe("SkillMenu", () => {
  it("bounds the upward menu so its heading stays visible in New chat", () => {
    render(
      <SkillMenu
        items={skills}
        query=""
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("listbox", { name: "Skills" })).toHaveClass("max-h-[190px]");
  });

  it("searches by name and description and selects a structured item", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SkillMenu
        items={skills}
        query="pdf"
        loading={false}
        error={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("$pdf")).toBeInTheDocument();
    expect(screen.queryByText("$brainstorming")).not.toBeInTheDocument();

    rerender(
      <SkillMenu
        items={skills}
        query="product"
        loading={false}
        error={null}
        onSelect={onSelect}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await userEvent.click(screen.getByText("$brainstorming"));
    expect(onSelect).toHaveBeenCalledWith(skills[1]);
  });

  it("renders loading and empty states", () => {
    const props = {
      items: [] as SkillPickerItem[],
      query: "",
      error: null,
      onSelect: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn()
    };
    const { rerender } = render(<SkillMenu {...props} loading />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(<SkillMenu {...props} loading={false} />);
    expect(screen.getByText("No Skills available")).toBeInTheDocument();
  });

  it("hides stale rows after an error and offers Retry", async () => {
    const onRetry = vi.fn();
    render(
      <SkillMenu
        items={skills}
        query=""
        loading={false}
        error={new Error("offline")}
        onSelect={vi.fn()}
        onRetry={onRetry}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Skills could not be refreshed")).toBeInTheDocument();
    expect(screen.queryByText("$pdf")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
