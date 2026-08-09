import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
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
    expect(screen.getByRole("listbox", { name: "Skills" }).parentElement).toHaveClass(
      "max-h-[190px]"
    );
    expect(screen.getByRole("option", { name: /\$pdf/i })).toHaveAttribute("tabindex", "-1");
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
    expect(screen.getByRole("status")).toHaveTextContent("Loading...");
    expect(screen.getByRole("listbox", { name: "Skills" })).toHaveAttribute("aria-busy", "true");

    rerender(<SkillMenu {...props} loading={false} />);
    expect(screen.getByText("No Skills available")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No Skills available");
  });

  it("hides stale rows after an error and offers Retry", async () => {
    const onRetry = vi.fn();
    const onSelect = vi.fn();
    const ownerRef = createRef<HTMLTextAreaElement>();
    const { rerender } = render(
      <>
        <SkillMenu
          items={skills}
          query=""
          loading={false}
          error={new Error("offline")}
          onSelect={onSelect}
          onRetry={onRetry}
          onClose={vi.fn()}
          ownerRef={ownerRef}
        />
        <textarea ref={ownerRef} aria-label="Owner" />
      </>
    );

    expect(screen.getByText("Skills could not be refreshed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Skills could not be refreshed");
    expect(screen.queryByText("$pdf")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(screen.getByRole("listbox", { name: "Skills" })).not.toContainElement(retry);
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: "Owner" })).toHaveFocus();

    rerender(
      <>
        <SkillMenu
          items={skills}
          query=""
          loading={false}
          error={null}
          onSelect={onSelect}
          onRetry={onRetry}
          onClose={vi.fn()}
          ownerRef={ownerRef}
        />
        <textarea ref={ownerRef} aria-label="Owner" />
      </>
    );
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(skills[1]);
  });

  it("scrolls the keyboard-active option into view", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
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
    scrollIntoView.mockClear();

    await userEvent.keyboard("{ArrowDown}");

    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(screen.getByRole("option", { name: /\$brainstorming/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("does not select a menu item while an IME composition is active", () => {
    const onSelect = vi.fn();
    const ownerRef = createRef<HTMLTextAreaElement>();
    render(
      <>
        <SkillMenu
          items={skills}
          query=""
          loading={false}
          error={null}
          onSelect={onSelect}
          onRetry={vi.fn()}
          onClose={vi.fn()}
          ownerRef={ownerRef}
        />
        <textarea ref={ownerRef} aria-label="Owner" />
      </>
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Owner" }), {
      key: "Enter",
      isComposing: true,
      keyCode: 229
    });

    expect(onSelect).not.toHaveBeenCalled();
  });
});
