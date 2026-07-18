import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageActions } from "./MessageActions.js";

afterEach(() => cleanup());

describe("MessageActions", () => {
  it("copies the full markdown", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MessageActions markdown={"# 结论\n正文"} />);
    await userEvent.click(screen.getByRole("button", { name: /copy|复制全文/i }));
    expect(writeText).toHaveBeenCalledWith("# 结论\n正文");
    vi.unstubAllGlobals();
  });

  it("exports via the electron bridge when present", async () => {
    const saveTextFile = vi.fn(async () => ({ saved: true, path: "/tmp/a.md" }));
    vi.stubGlobal("window", Object.assign(window, { marginalia: { saveTextFile } }));
    render(<MessageActions markdown="body" defaultName="report.md" />);
    await userEvent.click(screen.getByRole("button", { name: /export|导出/i }));
    expect(saveTextFile).toHaveBeenCalledWith({ defaultName: "report.md", content: "body" });
  });

  it("omits the workspace button without a handler", () => {
    render(<MessageActions markdown="x" />);
    expect(screen.queryByRole("button", { name: /workspace|存入/i })).not.toBeInTheDocument();
  });

  it("flashes copied feedback on success", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    render(<MessageActions markdown="x" />);
    await userEvent.click(screen.getByRole("button", { name: /copy|复制全文/i }));
    expect(await screen.findByRole("button", { name: /copied|已复制/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("flashes an error instead of crashing when the clipboard write fails", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MessageActions markdown="x" />);
    await userEvent.click(screen.getByRole("button", { name: /copy|复制全文/i }));
    expect(
      await screen.findByRole("button", { name: /copy failed|复制失败/i })
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("flashes an error when the export write fails", async () => {
    const saveTextFile = vi.fn(async () => ({ saved: false, error: "disk full" }));
    vi.stubGlobal("window", Object.assign(window, { marginalia: { saveTextFile } }));
    render(<MessageActions markdown="b" defaultName="r.md" />);
    await userEvent.click(screen.getByRole("button", { name: /export|导出/i }));
    expect(
      await screen.findByRole("button", { name: /export failed|导出失败/i })
    ).toBeInTheDocument();
  });

  it("flashes success after an export and stays quiet on cancel", async () => {
    const saveTextFile = vi.fn(
      async (): Promise<{ saved: boolean; path?: string; error?: string }> => ({
        saved: true,
        path: "/tmp/a.md"
      })
    );
    vi.stubGlobal("window", Object.assign(window, { marginalia: { saveTextFile } }));
    render(<MessageActions markdown="b" />);
    await userEvent.click(screen.getByRole("button", { name: /export|导出/i }));
    expect(await screen.findByRole("button", { name: /exported|已导出/i })).toBeInTheDocument();

    // Cancelled dialog: saved:false without an error keeps the idle label.
    saveTextFile.mockImplementation(async () => ({ saved: false }));
    render(<MessageActions markdown="c" />);
    const exportButtons = screen.getAllByRole("button", { name: /export|导出/i });
    await userEvent.click(exportButtons[exportButtons.length - 1]!);
    expect(
      screen.queryByRole("button", { name: /export failed|导出失败/i })
    ).not.toBeInTheDocument();
  });
});
