import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvalidSkillSelection } from "@/api/client.js";
import { SkillPreconditionBanner } from "./SkillPreconditionBanner.js";

afterEach(() => cleanup());

const invalidSelections: InvalidSkillSelection[] = [
  { name: "pdf", path: "/old/pdf", reason: "missing" },
  { name: "review", path: "/old/review", reason: "disabled" }
];

describe("SkillPreconditionBanner", () => {
  it("announces a compact repair flow and delegates every canonical action", async () => {
    const onRefresh = vi.fn();
    const onRemove = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <SkillPreconditionBanner
        invalidSelections={invalidSelections}
        refreshing={false}
        onRefresh={onRefresh}
        onRemove={onRemove}
        onOpenSettings={onOpenSettings}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Selected Skills changed");
    await userEvent.click(screen.getByRole("button", { name: "Refresh Skills" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove unavailable Skill pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Skills settings" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("/old/pdf");
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps 40px repair targets and disables Refresh while refreshing", () => {
    render(
      <SkillPreconditionBanner
        invalidSelections={invalidSelections.slice(0, 1)}
        refreshing
        onRefresh={vi.fn()}
        onRemove={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Refresh Skills" })).toBeDisabled();
    for (const button of screen.getAllByRole("button")) expect(button).toHaveClass("min-h-10");
  });
});
