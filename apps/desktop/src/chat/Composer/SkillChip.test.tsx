import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillCandidate } from "@/api/client.js";
import { SkillChip } from "./SkillChip.js";

afterEach(() => cleanup());

const candidate: SkillCandidate = {
  name: "pdf",
  description: "Review PDFs",
  discoveredPath: "/workspace/.agents/skills/pdf/SKILL.md",
  canonicalPath: "/canonical/pdf/SKILL.md",
  source: "ancestor_agents",
  scope: "workspace",
  status: "effective",
  enabled: true,
  effective: true,
  explicitOnly: true,
  explicitEligible: true,
  shadowedBy: null,
  bytesTotal: 10,
  diagnostics: [{ code: "pi_warning", level: "warning", message: "Check metadata" }]
};

describe("SkillChip", () => {
  it("shows identity, source tooltip, warning and explicit-only state", () => {
    render(
      <SkillChip
        skill={{ name: "pdf", path: candidate.canonicalPath }}
        candidate={candidate}
        onRemove={vi.fn()}
      />
    );

    expect(screen.getByText("$pdf")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Explicit only")).toBeInTheDocument();
    expect(screen.getByTitle(/Ancestor Agents.*canonical\/pdf\/SKILL\.md/)).toBeInTheDocument();
  });

  it("removes the canonical identity", async () => {
    const onRemove = vi.fn();
    render(
      <SkillChip
        skill={{ name: "pdf", path: candidate.canonicalPath }}
        candidate={candidate}
        onRemove={onRemove}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove Skill pdf" }));
    expect(onRemove).toHaveBeenCalledWith(candidate.canonicalPath);
  });

  it("keeps a very long Skill name inside the composer", () => {
    const name = "a".repeat(1024);
    render(<SkillChip skill={{ name, path: "/canonical/long/SKILL.md" }} onRemove={vi.fn()} />);

    expect(screen.getByTestId("skill-chip-/canonical/long/SKILL.md")).toHaveClass("max-w-full");
    expect(screen.getByText(`$${name}`)).toHaveClass("truncate");
  });

  it("marks only an invalid canonical identity without changing its footprint", () => {
    const { rerender } = render(
      <SkillChip
        skill={{ name: "pdf", path: candidate.canonicalPath }}
        candidate={candidate}
        invalid={false}
        onRemove={vi.fn()}
      />
    );
    const chip = screen.getByTestId(`skill-chip-${candidate.canonicalPath}`);
    const stableClasses = chip.className;

    rerender(
      <SkillChip
        skill={{ name: "pdf", path: candidate.canonicalPath }}
        candidate={candidate}
        invalid
        onRemove={vi.fn()}
      />
    );

    expect(chip).toHaveAttribute("data-invalid", "true");
    expect(chip).toHaveAttribute("aria-invalid", "true");
    expect(chip).toHaveClass("border-danger", "bg-danger-soft");
    expect(
      chip.className.replace("border-danger bg-danger-soft", "border-border bg-surface-2")
    ).toBe(stableClasses);
  });
});
