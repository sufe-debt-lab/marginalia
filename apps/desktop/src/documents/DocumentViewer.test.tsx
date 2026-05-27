import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentViewer } from "./DocumentViewer.js";

afterEach(() => cleanup());

describe("DocumentViewer", () => {
  it("renders empty state when no content", () => {
    render(<DocumentViewer path={null} content={null} loading={false} error={null} />);
    expect(screen.getByText(/select a file/i)).toBeInTheDocument();
  });

  it("renders markdown for .md", () => {
    render(
      <DocumentViewer
        path="x.md"
        content={{ path: "x.md", mime: "text/markdown", text: "# Hi", truncated: false }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi");
  });

  it("renders code with highlight", () => {
    render(
      <DocumentViewer
        path="x.ts"
        content={{ path: "x.ts", mime: "text/plain", text: "const a = 1;", truncated: false }}
        loading={false}
        error={null}
      />
    );
    expect(document.querySelector("pre code")).not.toBeNull();
  });

  it("renders error", () => {
    render(<DocumentViewer path="x" content={null} loading={false} error={new Error("nope")} />);
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("renders truncated warning", () => {
    render(
      <DocumentViewer
        path="big"
        content={{ path: "big", mime: "text/plain", text: "...", truncated: true }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });
});
