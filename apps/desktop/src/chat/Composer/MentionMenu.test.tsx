import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionMenu } from "./MentionMenu.js";

afterEach(() => cleanup());

describe("MentionMenu", () => {
  it("renders nothing when empty", () => {
    const { container } = render(
      <MentionMenu suggestions={[]} onSelect={() => {}} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a file on click", async () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        suggestions={[{ path: "src/App.tsx" }, { path: "README.md" }]}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    await userEvent.click(screen.getByText("src/App.tsx"));
    expect(onSelect).toHaveBeenCalledWith("src/App.tsx");
  });
});
