import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { Composer as ControlledComposer } from "./Composer.js";

const providers = [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }];

function api(): ApiClient {
  return {
    searchFiles: vi.fn(async () => [{ path: "src/App.tsx" }])
  } as unknown as ApiClient;
}

type TestComposerProps = Omit<
  ComponentProps<typeof ControlledComposer>,
  "text" | "onTextChange" | "skills"
> &
  Partial<Pick<ComponentProps<typeof ControlledComposer>, "text" | "onTextChange" | "skills">>;

function Composer(props: TestComposerProps) {
  const [text, setText] = useState(props.text ?? "");
  return (
    <ControlledComposer
      {...props}
      text={props.text ?? text}
      onTextChange={(next) => {
        if (props.text === undefined) setText(next);
        props.onTextChange?.(next);
      }}
      skills={props.skills ?? []}
    />
  );
}

describe("Composer", () => {
  beforeEach(() => cleanup());

  it("submits text via Send button", async () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={onSubmit}
        placeholder="Do anything…"
      />
    );
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith({ text: "hello", contextFiles: [], skills: [] });
  });

  it("submits a complete controlled turn without clearing any controlled value", async () => {
    const onSubmit = vi.fn();
    const onTextChange = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        text="Review"
        onTextChange={onTextChange}
        contextFiles={["/docs/a.pdf"]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        skills={[{ name: "pdf", path: "/skills/pdf" }]}
        sending={false}
        onSubmit={onSubmit}
        placeholder=""
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      text: "Review",
      contextFiles: ["/docs/a.pdf"],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    });
    expect(screen.getByRole("textbox", { name: /message/i })).toHaveValue("Review");
    expect(onTextChange).not.toHaveBeenCalled();
  });

  it("Ctrl/Cmd+Enter submits", async () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={onSubmit}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "hi");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith({ text: "hi", contextFiles: [], skills: [] });
  });

  it("@ inserts an inline mention token without creating an attachment card", async () => {
    const onAdd = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={onAdd}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "@");
    await userEvent.click(await screen.findByText("src/App.tsx"));
    expect(input).toHaveValue("@src/App.tsx ");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("opens the slash menu when '/' is typed mid-sentence", async () => {
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hello /mod");
    expect(await screen.findByText("/model")).toBeInTheDocument();
  });

  it("@ mid-sentence inserts an inline mention token", async () => {
    const onAdd = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={onAdd}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "see @App");
    await userEvent.click(await screen.findByText("src/App.tsx"));
    expect(input).toHaveValue("see @src/App.tsx ");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("the + button opens an attachment picker and selecting adds a context file", async () => {
    const onAdd = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={onAdd}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /add attachment/i }));
    await userEvent.click(await screen.findByText("src/App.tsx"));
    expect(onAdd).toHaveBeenCalledWith("src/App.tsx");
  });

  it("can send with only attachments and no text", async () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={["src/x.ts"]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={onSubmit}
        placeholder=""
      />
    );
    const send = screen.getByRole("button", { name: /send/i });
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith({
      text: "",
      contextFiles: ["src/x.ts"],
      skills: []
    });
  });

  it("grows the send button on hover (matches design micro-interaction)", () => {
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    expect(screen.getByRole("button", { name: /send/i })).toHaveClass("hover:scale-[1.06]");
  });

  it("does not animate initial attachment cards but animates newly added cards", async () => {
    const initialProps = {
      api: api(),
      workspaceId: "w",
      providers,
      providerId: "p1",
      model: "M2.7",
      onModelChange: vi.fn(),
      onAddContextFile: vi.fn(),
      onRemoveContextFile: vi.fn(),
      sending: false,
      onSubmit: vi.fn(),
      placeholder: ""
    };
    const { rerender } = render(<Composer {...initialProps} contextFiles={["src/x.ts"]} />);
    expect(
      screen.getByRole("button", { name: /remove src\/x\.ts/i }).parentElement
    ).not.toHaveClass("motion-menu");

    rerender(<Composer {...initialProps} contextFiles={["src/x.ts", "src/y.ts"]} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /remove src\/y\.ts/i }).parentElement).toHaveClass(
        "motion-menu"
      )
    );
  });

  it("disables send when the disabled prop is set, even with attachments", () => {
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={["a.ts"]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        disabled
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("changing permission calls onPermissionChange", async () => {
    const onPermissionChange = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        permission="full"
        reasoning="medium"
        onPermissionChange={onPermissionChange}
        onReasoningChange={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /tool permission/i }));
    await userEvent.click(await screen.findByText("Read-only"));
    expect(onPermissionChange).toHaveBeenCalledWith("readonly");
  });

  it("replaces send with stop while sending", () => {
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={true}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    expect(screen.queryByRole("button", { name: /send/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("shows a stop button while sending", async () => {
    const onStop = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={true}
        onStop={onStop}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalled();
  });
});
