import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTabs } from "./DocumentTabs.js";

afterEach(() => cleanup());

describe("DocumentTabs", () => {
  it("renders tabs with active highlight", () => {
    render(
      <DocumentTabs
        tabs={["README.md", "src/App.tsx"]}
        activeTab="src/App.tsx"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("close removes a tab", async () => {
    const onClose = vi.fn();
    render(
      <DocumentTabs
        tabs={["README.md"]}
        activeTab="README.md"
        onSelect={() => {}}
        onClose={onClose}
        onAdd={() => {}}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /close README\.md/i }));
    expect(onClose).toHaveBeenCalledWith("README.md");
  });

  it("select switches active tab", async () => {
    const onSelect = vi.fn();
    render(
      <DocumentTabs
        tabs={["README.md", "src/App.tsx"]}
        activeTab="README.md"
        onSelect={onSelect}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    await userEvent.click(screen.getByText("App.tsx"));
    expect(onSelect).toHaveBeenCalledWith("src/App.tsx");
  });

  it("add button triggers onAdd", async () => {
    const onAdd = vi.fn();
    render(
      <DocumentTabs tabs={[]} activeTab={null} onSelect={() => {}} onClose={() => {}} onAdd={onAdd} />
    );
    await userEvent.click(screen.getByRole("button", { name: /add tab/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});
