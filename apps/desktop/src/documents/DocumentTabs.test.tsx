import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTabs } from "./DocumentTabs.js";

afterEach(() => cleanup());

describe("DocumentTabs", () => {
  it("renders tabs with active highlight", () => {
    render(
      <DocumentTabs
        tabs={[
          { path: "README.md", pinned: false },
          { path: "src/App.tsx", pinned: true }
        ]}
        activeTab="src/App.tsx"
        onSelect={() => {}}
        onClose={() => {}}
        onPin={() => {}}
      />
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("close removes a tab", async () => {
    const onClose = vi.fn();
    render(
      <DocumentTabs
        tabs={[{ path: "README.md", pinned: false }]}
        activeTab="README.md"
        onSelect={() => {}}
        onClose={onClose}
        onPin={() => {}}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /close README\.md/i }));
    expect(onClose).toHaveBeenCalledWith("README.md");
  });

  it("select switches active tab", async () => {
    const onSelect = vi.fn();
    render(
      <DocumentTabs
        tabs={[
          { path: "README.md", pinned: false },
          { path: "src/App.tsx", pinned: false }
        ]}
        activeTab="README.md"
        onSelect={onSelect}
        onClose={() => {}}
        onPin={() => {}}
      />
    );
    await userEvent.click(screen.getByText("App.tsx"));
    expect(onSelect).toHaveBeenCalledWith("src/App.tsx");
  });
});
