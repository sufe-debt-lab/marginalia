import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button.js";

describe("Button", () => {
  it("renders shadcn button classes", () => {
    render(<Button variant="secondary">Tailwind OK</Button>);
    expect(screen.getByRole("button", { name: "Tailwind OK" })).toHaveClass("bg-secondary");
  });
});
