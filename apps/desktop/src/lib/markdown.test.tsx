import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { createMarkdownComponents } from "./markdown.js";

function md(text: string, prefix?: string) {
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(prefix)}>
      {text}
    </ReactMarkdown>
  );
}

describe("createMarkdownComponents", () => {
  it("renders heading hierarchy with line-based ids when a prefix is given", () => {
    // ids come from the markdown source line (react-markdown node.position),
    // so "# One" is line 1 and "## Two" is line 3 (blank line between).
    md("# One\n\n## Two", "m1");
    expect(screen.getByText("One").id).toBe("m1-h-1");
    expect(screen.getByText("Two").id).toBe("m1-h-3");
    expect(screen.getByText("One").className).toMatch(/font-semibold/);
  });

  it("keeps headings id-less without a prefix", () => {
    md("# Solo");
    expect(screen.getByText("Solo").id).toBe("");
  });
});
