import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentTree } from "./DocumentTree.js";

afterEach(() => cleanup());

describe("DocumentTree", () => {
  it("renders empty state when no paths", () => {
    render(<DocumentTree paths={[]} onSelect={() => {}} />);
    expect(screen.getByText(/no files/i)).toBeInTheDocument();
  });

  it("renders a host element when paths are provided", () => {
    const { container } = render(
      <DocumentTree paths={["README.md", "src/App.tsx"]} onSelect={() => {}} />
    );
    expect(container.querySelector("[data-pierre-tree-host]")).not.toBeNull();
  });
});
