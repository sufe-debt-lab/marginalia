import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store.js";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      turnDrafts: {},
      pendingTurn: null,
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 238
    });
    localStorage.clear();
  });

  it("starts on new-thread view with no active workspace", () => {
    const s = useAppStore.getState();
    expect(s.view).toBe("new-thread");
    expect(s.locale).toBe("en");
    expect(s.activeWorkspaceId).toBeNull();
  });

  it("switches locale", () => {
    useAppStore.getState().setLocale("zh");
    expect(useAppStore.getState().locale).toBe("zh");
  });

  it("defaults permission=full and reasoning=medium", () => {
    const s = useAppStore.getState();
    expect(s.permission).toBe("full");
    expect(s.reasoning).toBe("medium");
  });

  it("sets composer model, permission and reasoning", () => {
    const s = useAppStore.getState();
    s.setComposerModel("p1", "gpt-5.1");
    s.setPermission("readonly");
    s.setReasoning("high");
    const next = useAppStore.getState();
    expect(next.composerProviderId).toBe("p1");
    expect(next.composerModel).toBe("gpt-5.1");
    expect(next.permission).toBe("readonly");
    expect(next.reasoning).toBe("high");
  });

  it("switches view", () => {
    useAppStore.getState().setView("chat");
    expect(useAppStore.getState().view).toBe("chat");
  });

  it("toggles sidebars", () => {
    const { toggleLeftSidebar, toggleRightPanel } = useAppStore.getState();
    toggleLeftSidebar();
    expect(useAppStore.getState().leftSidebarCollapsed).toBe(true);
    toggleRightPanel();
    expect(useAppStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("isolates complete turn drafts by session and new-thread owner", () => {
    const store = useAppStore.getState();
    const owners = ["session:s1", "session:s2", "new:w1", "new:w2"] as const;

    owners.forEach((owner, index) => {
      store.setTurnText(owner, `text-${index}`);
      store.addTurnContextFile(owner, `/context/${index}.md`);
      store.addTurnSkill(owner, { name: `skill-${index}`, path: `/skills/${index}` });
    });

    owners.forEach((owner, index) => {
      expect(store.getTurnDraft(owner)).toEqual({
        text: `text-${index}`,
        contextFiles: [`/context/${index}.md`],
        skills: [{ name: `skill-${index}`, path: `/skills/${index}` }]
      });
    });
  });

  it("deduplicates canonical paths while preserving the first selection", () => {
    const store = useAppStore.getState();
    store.addTurnContextFile("session:s1", "/docs/a.md");
    store.addTurnContextFile("session:s1", "/docs/a.md");
    store.addTurnSkill("session:s1", { name: "pdf", path: "/skills/pdf" });
    store.addTurnSkill("session:s1", { name: "renamed", path: "/skills/pdf" });
    store.replaceTurnSkills("session:s1", [
      { name: "pdf", path: "/skills/pdf" },
      { name: "renamed", path: "/skills/pdf" },
      { name: "review", path: "/skills/review" }
    ]);

    expect(store.getTurnDraft("session:s1")).toEqual({
      text: "",
      contextFiles: ["/docs/a.md"],
      skills: [
        { name: "pdf", path: "/skills/pdf" },
        { name: "review", path: "/skills/review" }
      ]
    });
  });

  it("returns fresh draft snapshots and atomically moves or clears only the target owner", () => {
    const store = useAppStore.getState();
    store.setTurnText("new:w1", "move me");
    store.addTurnContextFile("new:w1", "/docs/a.md");
    store.addTurnSkill("new:w1", { name: "pdf", path: "/skills/pdf" });
    store.setTurnText("new:w2", "keep me");

    const moved = store.moveTurnDraft("new:w1", "session:s3");
    moved.contextFiles.push("mutated.md");
    moved.skills[0]!.name = "mutated";

    expect(store.getTurnDraft("new:w1")).toEqual({ text: "", contextFiles: [], skills: [] });
    expect(store.getTurnDraft("session:s3")).toEqual({
      text: "move me",
      contextFiles: ["/docs/a.md"],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    });
    expect(store.getTurnDraft("new:w2").text).toBe("keep me");

    const missingA = store.getTurnDraft("session:missing");
    const missingB = store.getTurnDraft("session:missing");
    expect(missingA).not.toBe(missingB);
    expect(missingA.contextFiles).not.toBe(missingB.contextFiles);
    expect(missingA.skills).not.toBe(missingB.skills);

    store.clearTurnDraft("session:s3");
    expect(store.getTurnDraft("session:s3")).toEqual({ text: "", contextFiles: [], skills: [] });
    expect(store.getTurnDraft("new:w2").text).toBe("keep me");
  });

  it("moves a submitted snapshot without deleting later edits on the source owner", () => {
    const store = useAppStore.getState();
    const submitted = {
      text: "first",
      contextFiles: ["/docs/a.md"],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    };
    store.setTurnText("new:w1", "first");
    store.addTurnContextFile("new:w1", "/docs/a.md");
    store.addTurnSkill("new:w1", { name: "pdf", path: "/skills/pdf" });
    store.setTurnText("new:w1", "later edit");

    expect(store.moveTurnDraft("new:w1", "session:s3", submitted)).toEqual(submitted);
    expect(store.getTurnDraft("session:s3")).toEqual(submitted);
    expect(store.getTurnDraft("new:w1")).toEqual({
      text: "later edit",
      contextFiles: ["/docs/a.md"],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    });
  });

  it("claims a matching pending turn exactly once without clearing the session draft", () => {
    const store = useAppStore.getState();
    store.setTurnText("session:s3", "keep until accepted");
    store.setPendingTurn({
      sessionId: "s3",
      turn: {
        text: "keep until accepted",
        contextFiles: ["/docs/a.md"],
        skills: [{ name: "pdf", path: "/skills/pdf" }]
      }
    });

    expect(store.claimPendingTurn("other")).toBeNull();
    expect(store.claimPendingTurn("s3")).toEqual({
      text: "keep until accepted",
      contextFiles: ["/docs/a.md"],
      skills: [{ name: "pdf", path: "/skills/pdf" }]
    });
    expect(store.claimPendingTurn("s3")).toBeNull();
    expect(store.getTurnDraft("session:s3").text).toBe("keep until accepted");
  });

  it("never persists turn drafts or a pending turn", () => {
    const store = useAppStore.getState();
    store.setTurnText("session:s1", "private draft");
    store.setPendingTurn({
      sessionId: "s1",
      turn: { text: "private draft", contextFiles: [], skills: [] }
    });
    store.setLocale("zh");

    const persisted = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    expect(persisted.state).not.toHaveProperty("turnDrafts");
    expect(persisted.state).not.toHaveProperty("pendingTurn");
  });

  it("persists only the partialize-listed fields", () => {
    const { setActiveWorkspace, setActiveSession, setLocale, toggleLeftSidebar, setPendingTurn } =
      useAppStore.getState();
    setActiveWorkspace("ws-1");
    setActiveSession("s-1");
    setLocale("zh");
    setPendingTurn({
      sessionId: "s-1",
      turn: { text: "draft", contextFiles: [], skills: [] }
    });
    toggleLeftSidebar();

    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    const state = stored.state ?? {};
    expect(state.activeWorkspaceId).toBe("ws-1");
    expect(state.locale).toBe("zh");
    expect(state.leftSidebarCollapsed).toBe(true);
    expect(state.activeSessionId).toBeUndefined();
    expect(state.pendingTurn).toBeUndefined();
    expect(state.view).toBeUndefined();
  });

  it("togglePin adds and removes workspace ids", () => {
    const { togglePin } = useAppStore.getState();
    togglePin("w1");
    togglePin("w2");
    expect(useAppStore.getState().pinnedWorkspaceIds).toEqual(["w1", "w2"]);
    togglePin("w1");
    expect(useAppStore.getState().pinnedWorkspaceIds).toEqual(["w2"]);
  });

  it("removePin removes the id silently (no-op when not present)", () => {
    const { togglePin, removePin } = useAppStore.getState();
    togglePin("w1");
    removePin("w1");
    expect(useAppStore.getState().pinnedWorkspaceIds).toEqual([]);
    removePin("never");
    expect(useAppStore.getState().pinnedWorkspaceIds).toEqual([]);
  });

  it("setLeftSidebarWidth clamps between 180 and 480 and persists", () => {
    const { setLeftSidebarWidth } = useAppStore.getState();
    setLeftSidebarWidth(50);
    expect(useAppStore.getState().leftSidebarWidth).toBe(180);
    setLeftSidebarWidth(9999);
    expect(useAppStore.getState().leftSidebarWidth).toBe(480);
    setLeftSidebarWidth(300);
    expect(useAppStore.getState().leftSidebarWidth).toBe(300);
    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    expect(stored.state?.leftSidebarWidth).toBe(300);
    expect(stored.state?.pinnedWorkspaceIds).toBeDefined();
  });

  it("setRightPanelWidth clamps between 280 and 640 and persists", () => {
    const { setRightPanelWidth } = useAppStore.getState();
    expect(useAppStore.getState().rightPanelWidth).toBe(388);
    setRightPanelWidth(100);
    expect(useAppStore.getState().rightPanelWidth).toBe(280);
    setRightPanelWidth(9999);
    expect(useAppStore.getState().rightPanelWidth).toBe(640);
    setRightPanelWidth(420);
    expect(useAppStore.getState().rightPanelWidth).toBe(420);
    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    expect(stored.state?.rightPanelWidth).toBe(420);
  });
});
