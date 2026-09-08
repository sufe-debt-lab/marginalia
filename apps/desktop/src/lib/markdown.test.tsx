import { cleanup, render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { afterEach, describe, expect, it } from "vitest";
import { createMarkdownComponents } from "./markdown.js";

afterEach(() => cleanup());

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

  it("renders language-tagged fences through CodeBlock without an outer pre wrapper", () => {
    const { container } = md("```ts\nconst a = 1;\n```");
    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy|复制/i })).toBeInTheDocument();
    // CodeBlock must not sit inside react-markdown's default <pre> (invalid pre > div nesting).
    expect(container.querySelector("pre > div")).toBeNull();
  });

  it("renders fences without a language through CodeBlock too", () => {
    const { container } = md("```\nplain body\n```");
    expect(screen.getByText("text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy|复制/i })).toBeInTheDocument();
    expect(container.querySelector("pre > div")).toBeNull();
  });

  it("keeps inline code as a chip without a copy button", () => {
    md("before `x` after");
    expect(screen.getByText("x").className).toMatch(/bg-muted/);
    expect(screen.queryByRole("button", { name: /copy|复制/i })).not.toBeInTheDocument();
  });

  it("opens only web links in a new window; anchors keep default in-page behavior", () => {
    md("[web](https://example.com) and [anchor](#sec)");
    expect(screen.getByText("web")).toHaveAttribute("target", "_blank");
    expect(screen.getByText("anchor")).not.toHaveAttribute("target");
  });
});
