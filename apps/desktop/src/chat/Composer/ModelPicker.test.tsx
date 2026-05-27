import { afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker.js";

const providers = [
  { id: "p1", name: "Minimax", defaultModel: "M2.7" },
  { id: "p2", name: "OpenAI", defaultModel: "gpt-4o" }
];

describe("ModelPicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows current model on trigger", () => {
    render(
      <ModelPicker providers={providers} providerId="p1" model="M2.7" onChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: /Minimax · M2.7/i })).toBeInTheDocument();
  });

  it("changing provider calls onChange with default model of new provider", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker providers={providers} providerId="p1" model="M2.7" onChange={onChange} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Minimax/i }));
    await waitFor(() => screen.getByText("OpenAI"));
    await userEvent.click(screen.getByText("OpenAI"));
    expect(onChange).toHaveBeenCalledWith({ providerId: "p2", model: "gpt-4o" });
  });
});
