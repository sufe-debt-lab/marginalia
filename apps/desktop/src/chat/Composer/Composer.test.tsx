import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, SkillCandidate, SkillCatalogSnapshot } from "@/api/client.js";
import { useSkillCatalog } from "@/hooks/useSkillCatalog.js";
import { Composer as ControlledComposer } from "./Composer.js";

const providers = [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }];

function candidate(name: string, overrides: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    name,
    description: `${name} description`,
    discoveredPath: `/discovered/${name}/SKILL.md`,
    canonicalPath: `/skills/${name}/SKILL.md`,
    source: "workspace_marginalia",
    scope: "workspace",
    status: "effective",
    enabled: true,
    effective: true,
    explicitOnly: false,
    explicitEligible: true,
    shadowedBy: null,
    bytesTotal: 10,
    diagnostics: [],
    ...overrides
  };
}

function skillSnapshot(candidates: SkillCandidate[]): SkillCatalogSnapshot {
  return {
    workspaceId: "w",
    catalogRevision: "catalog",
    effectiveRevision: "effective",
    refreshedAt: 1,
    candidates,
    diagnostics: []
  };
}

function api(skills: SkillCandidate[] = []): ApiClient {
  return {
    searchFiles: vi.fn(async () => [{ path: "src/App.tsx" }]),
    listSkills: vi.fn(async () => skillSnapshot(skills))
  } as unknown as ApiClient;
}

type TestComposerProps = Omit<
  ComponentProps<typeof ControlledComposer>,
  "text" | "onTextChange" | "skills" | "onAddSkill" | "onRemoveSkill" | "skillCatalog"
> &
  Partial<
    Pick<
      ComponentProps<typeof ControlledComposer>,
      "text" | "onTextChange" | "skills" | "onAddSkill" | "onRemoveSkill"
    >
  >;

function Composer(props: TestComposerProps) {
  const [text, setText] = useState(props.text ?? "");
  const skillCatalog = useSkillCatalog(props.api, props.workspaceId);
  return (
    <ControlledComposer
      {...props}
      skillCatalog={skillCatalog}
      text={props.text ?? text}
      onTextChange={(next) => {
        if (props.text === undefined) setText(next);
        props.onTextChange?.(next);
      }}
      skills={props.skills ?? []}
      onAddSkill={props.onAddSkill ?? (() => {})}
      onRemoveSkill={props.onRemoveSkill ?? (() => {})}
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

  it("selects the open Skill menu item without also submitting on Cmd/Ctrl+Enter", async () => {
    const pdf = candidate("pdf");
    const onAddSkill = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Composer
        api={api([pdf])}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        onAddSkill={onAddSkill}
        onRemoveSkill={vi.fn()}
        sending={false}
        onSubmit={onSubmit}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "$pdf");
    const listbox = await screen.findByRole("listbox", { name: "Skills" });

    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /\$pdf/i }).id
    );

    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onAddSkill).toHaveBeenCalledWith({ name: "pdf", path: pdf.canonicalPath });
    expect(onSubmit).not.toHaveBeenCalled();
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

  it.each(["$", "/"] as const)(
    "selects the same structured Skill from the %s entry and removes the trigger token",
    async (symbol) => {
      const pdf = candidate("pdf");
      const client = api([pdf]);
      const onAddSkill = vi.fn();
      render(
        <Composer
          api={client}
          workspaceId="w"
          providers={providers}
          providerId="p1"
          model="M2.7"
          onModelChange={vi.fn()}
          contextFiles={[]}
          onAddContextFile={vi.fn()}
          onRemoveContextFile={vi.fn()}
          onAddSkill={onAddSkill}
          onRemoveSkill={vi.fn()}
          sending={false}
          onSubmit={vi.fn()}
          placeholder=""
        />
      );
      const input = screen.getByRole("textbox", { name: /message/i });
      await waitFor(() => expect(client.listSkills).toHaveBeenCalledTimes(1));

      await userEvent.type(input, `${symbol}pdf`);
      await userEvent.click(await screen.findByRole("option", { name: /\$pdf/i }));

      expect(input).toHaveValue("");
      expect(input).not.toHaveValue(expect.stringContaining("/skill:"));
      expect(onAddSkill).toHaveBeenCalledWith({ name: "pdf", path: pdf.canonicalPath });
      expect(client.listSkills).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    {
      label: "typing whitespace after a Skill query",
      before: "$pdf",
      edit: " ",
      expected: "$pdf "
    },
    { label: "deleting the Skill trigger", before: "$", edit: "{Backspace}", expected: "" }
  ])("closes the Skill menu after $label", async ({ before, edit, expected }) => {
    const onAddSkill = vi.fn();
    render(
      <Composer
        api={api([candidate("pdf")])}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        onAddSkill={onAddSkill}
        onRemoveSkill={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, before);
    expect(await screen.findByRole("listbox", { name: "Skills" })).toBeInTheDocument();

    await userEvent.type(input, edit);

    expect(screen.queryByRole("listbox", { name: "Skills" })).not.toBeInTheDocument();
    expect(input).toHaveValue(expected);
    expect(onAddSkill).not.toHaveBeenCalled();
  });

  it("shows only effective enabled explicit-eligible named Skills", async () => {
    const eligible = candidate("eligible");
    const client = api([
      eligible,
      candidate("disabled", { enabled: false, effective: false, status: "disabled" }),
      candidate("shadowed", { effective: false, status: "shadowed" }),
      candidate("invalid", { effective: false, status: "invalid" }),
      candidate("large", { explicitEligible: false }),
      candidate("unnamed", { name: null })
    ]);
    render(
      <Composer
        api={client}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        onAddSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );

    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "$");
    expect(await screen.findByText("$eligible")).toBeInTheDocument();
    for (const name of ["disabled", "shadowed", "invalid", "large", "unnamed"]) {
      expect(screen.queryByText(`$${name}`)).not.toBeInTheDocument();
    }
  });

  it("blocks stale Skill rows after an open refresh fails and allows an explicit retry", async () => {
    const pdf = candidate("pdf");
    const client = api([pdf]);
    (client.listSkills as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(skillSnapshot([pdf]))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(skillSnapshot([pdf]));
    render(
      <Composer
        api={client}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        onAddSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await waitFor(() => expect(client.listSkills).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "$");
    expect(await screen.findByText("Skills could not be refreshed")).toBeInTheDocument();
    expect(screen.queryByText("$pdf")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("$pdf")).toBeInTheDocument();
    expect(client.listSkills).toHaveBeenCalledTimes(3);
  });

  it("blocks stale Skill rows when an open refresh returns another workspace", async () => {
    const pdf = candidate("pdf");
    const client = api([pdf]);
    (client.listSkills as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(skillSnapshot([pdf]))
      .mockResolvedValueOnce({ ...skillSnapshot([pdf]), workspaceId: "other" });
    render(
      <Composer
        api={client}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        onAddSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await waitFor(() => expect(client.listSkills).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "$");

    expect(await screen.findByText("Skills could not be refreshed")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /\$pdf/i })).not.toBeInTheDocument();
  });

  it("renders Skill chips in selection order and delegates canonical removal", async () => {
    const onRemoveSkill = vi.fn();
    render(
      <Composer
        api={api([candidate("brainstorming"), candidate("pdf")])}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        skills={[
          { name: "brainstorming", path: "/skills/brainstorming/SKILL.md" },
          { name: "pdf", path: "/skills/pdf/SKILL.md" }
        ]}
        onAddSkill={vi.fn()}
        onRemoveSkill={onRemoveSkill}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );

    expect(screen.getAllByTestId(/^skill-chip-/).map((item) => item.textContent)).toEqual([
      expect.stringContaining("$brainstorming"),
      expect.stringContaining("$pdf")
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove Skill pdf" }));
    expect(onRemoveSkill).toHaveBeenCalledWith("/skills/pdf/SKILL.md");
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

  it("does not let a stale mention search compete with a newer Skill menu", async () => {
    let finishSearch!: (items: { path: string }[]) => void;
    const client = api([candidate("pdf")]);
    (client.searchFiles as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSearch = resolve;
        })
    );
    const onAddContextFile = vi.fn();
    const onAddSkill = vi.fn();
    render(
      <Composer
        api={client}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={onAddContextFile}
        onRemoveContextFile={vi.fn()}
        onAddSkill={onAddSkill}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "@a");
    await userEvent.clear(input);
    await userEvent.type(input, "$pdf");
    expect(await screen.findByRole("listbox", { name: "Skills" })).toBeInTheDocument();

    await act(async () => finishSearch([{ path: "stale.md" }]));

    expect(screen.queryByRole("listbox", { name: "File suggestions" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Skills" })).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onAddSkill).toHaveBeenCalledWith({ name: "pdf", path: "/skills/pdf/SKILL.md" });
    expect(onAddContextFile).not.toHaveBeenCalled();
  });

  it("the + button returns focus to the textarea for attachment keyboard selection and Escape", async () => {
    const onAdd = vi.fn();
    const client = api();
    (client.searchFiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { path: "src/App.tsx" },
      { path: "README.md" }
    ]);
    render(
      <Composer
        api={client}
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
    await userEvent.click(screen.getByRole("button", { name: /add attachment/i }));
    const menu = await screen.findByRole("listbox", { name: "File suggestions" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-controls", menu.id);

    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onAdd).toHaveBeenCalledWith("README.md");

    await userEvent.click(screen.getByRole("button", { name: /add attachment/i }));
    expect(await screen.findByRole("listbox", { name: "File suggestions" })).toBeInTheDocument();
    expect(input).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "File suggestions" })).not.toBeInTheDocument();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("does not publish a pending attachment menu after focus moves to another control", async () => {
    let finishSearch!: (items: { path: string }[]) => void;
    const client = api();
    (client.searchFiles as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSearch = resolve;
        })
    );
    render(
      <Composer
        api={client}
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

    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.click(screen.getByRole("button", { name: /add attachment/i }));
    await userEvent.click(screen.getByRole("button", { name: /tool permission/i }));
    expect(await screen.findByText("Read-only")).toBeInTheDocument();

    await act(async () => finishSearch([{ path: "stale.md" }]));

    expect(screen.queryByText("stale.md")).not.toBeInTheDocument();
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(input).not.toHaveFocus();
  });

  it("does not publish a stale attachment search after the workspace changes", async () => {
    let finishSearch!: (items: { path: string }[]) => void;
    const client = api();
    (client.searchFiles as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSearch = resolve;
        })
    );
    const props = {
      api: client,
      providers,
      providerId: "p1",
      model: "M2.7",
      onModelChange: vi.fn(),
      contextFiles: [] as string[],
      onAddContextFile: vi.fn(),
      onRemoveContextFile: vi.fn(),
      sending: false,
      onSubmit: vi.fn(),
      placeholder: ""
    };
    const view = render(<Composer {...props} workspaceId="w" />);

    await userEvent.click(screen.getByRole("button", { name: /add attachment/i }));
    view.rerender(<Composer {...props} workspaceId="w2" />);
    await act(async () => finishSearch([{ path: "stale.md" }]));

    expect(screen.queryByRole("listbox", { name: "File suggestions" })).not.toBeInTheDocument();
  });

  it("closes an already-open file menu when the workspace changes", async () => {
    const client = api();
    const props = {
      api: client,
      providers,
      providerId: "p1",
      model: "M2.7",
      onModelChange: vi.fn(),
      contextFiles: [] as string[],
      onAddContextFile: vi.fn(),
      onRemoveContextFile: vi.fn(),
      sending: false,
      onSubmit: vi.fn(),
      placeholder: ""
    };
    const view = render(<Composer {...props} workspaceId="w" />);

    await userEvent.click(screen.getByRole("button", { name: /add attachment/i }));
    expect(await screen.findByRole("listbox", { name: "File suggestions" })).toBeInTheDocument();

    view.rerender(<Composer {...props} workspaceId="w2" />);

    expect(screen.queryByRole("listbox", { name: "File suggestions" })).not.toBeInTheDocument();
  });

  it("hides old mention results and Escape cancels the refined pending search", async () => {
    let finishRefinedSearch!: (items: { path: string }[]) => void;
    const client = api();
    (client.searchFiles as ReturnType<typeof vi.fn>).mockImplementation(
      async (_workspaceId: string, query: string) => {
        if (query === "a") return [{ path: "alpha.md" }];
        if (query === "ab") {
          return new Promise((resolve) => {
            finishRefinedSearch = resolve;
          });
        }
        return [];
      }
    );
    render(
      <Composer
        api={client}
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
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "@a");
    expect(await screen.findByText("alpha.md")).toBeInTheDocument();

    await userEvent.type(input, "b");
    expect(screen.queryByText("alpha.md")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await act(async () => finishRefinedSearch([{ path: "about.md" }]));

    expect(screen.queryByRole("listbox", { name: "File suggestions" })).not.toBeInTheDocument();
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
