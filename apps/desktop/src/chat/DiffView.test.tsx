import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiffView } from "./DiffView.js";

const patch = ["--- a/a.md", "+++ b/a.md", "@@ -1,2 +1,2 @@", " context", "-old", "+new"].join(
  "\n"
);

describe("DiffView", () => {
  it("colors additions and deletions", () => {
    render(<DiffView patch={patch} />);
    expect(screen.getByText("+new")).toBeInTheDocument();
    expect(screen.getByText("-old")).toBeInTheDocument();
  });

  it("folds long patches behind an expand button", async () => {
    const longPatch = ["@@ -1 +1 @@", ...Array.from({ length: 200 }, (_, i) => `+line ${i}`)].join(
      "\n"
    );
    render(<DiffView patch={longPatch} />);
    expect(screen.queryByText("+line 199")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("+line 199")).toBeInTheDocument();
  });
});
