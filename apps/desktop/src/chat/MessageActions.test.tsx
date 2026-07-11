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
});
