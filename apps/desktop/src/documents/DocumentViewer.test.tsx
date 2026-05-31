import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentViewer } from "./DocumentViewer.js";

const pdfMocks = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const getPage = vi.fn(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }),
    render
  }));
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 1, getPage }),
    destroy
  }));
  return { destroy, getDocument, getPage, render };
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: {},
  getDocument: pdfMocks.getDocument
}));

vi.mock("pdfjs-dist/legacy/build/pdf.worker.mjs?url", () => ({
  default: "pdf.worker.mjs"
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

  it("renders PDFs with the app PDF canvas preview", async () => {
    render(
      <DocumentViewer
        path="paper.pdf"
        content={{
          path: "paper.pdf",
          mime: "application/pdf",
          text: "",
          truncated: false,
          rawOnly: true
        }}
        loading={false}
        error={null}
        fileUrl="http://127.0.0.1:3000/workspaces/w/files/raw?path=paper.pdf"
      />
    );
    expect(await screen.findByLabelText("PDF preview")).toBeInTheDocument();
    await waitFor(() =>
      expect(pdfMocks.getDocument).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/workspaces/w/files/raw?path=paper.pdf"
      )
    );
    expect(pdfMocks.getPage).toHaveBeenCalledWith(1);
  });

  it("renders images through the raw file URL", () => {
    render(
      <DocumentViewer
        path="image.png"
        content={{ path: "image.png", mime: "image/png", text: "", truncated: false, rawOnly: true }}
        loading={false}
        error={null}
        fileUrl="http://127.0.0.1:3000/workspaces/w/files/raw?path=image.png"
      />
    );
    expect(screen.getByRole("img", { name: "image.png" })).toHaveAttribute(
      "src",
      "http://127.0.0.1:3000/workspaces/w/files/raw?path=image.png"
    );
  });

  it("shows a tip for unsupported raw-only Word documents", () => {
    render(
      <DocumentViewer
        path="review.docx"
        content={{
          path: "review.docx",
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          text: "",
          truncated: false,
          rawOnly: true
        }}
        loading={false}
        error={null}
        fileUrl="http://127.0.0.1:3000/workspaces/w/files/raw?path=review.docx"
      />
    );
    expect(screen.getByText(/Word document previews aren't supported yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Open this file outside pi-cowork/i)).toBeInTheDocument();
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
