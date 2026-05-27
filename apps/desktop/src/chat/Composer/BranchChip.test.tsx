import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { BranchChip } from "./BranchChip.js";

afterEach(() => cleanup());

describe("BranchChip", () => {
  it("renders nothing when getBranch returns null", async () => {
    const api = { getBranch: vi.fn(async () => null) } as unknown as ApiClient;
    const { container } = render(<BranchChip api={api} workspaceId="w" />);
    await waitFor(() => expect(api.getBranch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders branch name", async () => {
    const api = { getBranch: vi.fn(async () => "main") } as unknown as ApiClient;
    render(<BranchChip api={api} workspaceId="w" />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
  });
});
