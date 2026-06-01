import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./app-store.js";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 240
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

  it("adds and removes context files without duplicates", () => {
    const { addContextFile, removeContextFile } = useAppStore.getState();
    addContextFile("a.ts");
    addContextFile("a.ts");
    addContextFile("b.ts");
    expect(useAppStore.getState().contextFiles).toEqual(["a.ts", "b.ts"]);
    removeContextFile("a.ts");
    expect(useAppStore.getState().contextFiles).toEqual(["b.ts"]);
  });

  it("clears context files", () => {
    const { addContextFile, clearContextFiles } = useAppStore.getState();
    addContextFile("a.ts");
    clearContextFiles();
    expect(useAppStore.getState().contextFiles).toEqual([]);
  });

  it("toggles sidebars", () => {
    const { toggleLeftSidebar, toggleRightPanel } = useAppStore.getState();
    toggleLeftSidebar();
    expect(useAppStore.getState().leftSidebarCollapsed).toBe(true);
    toggleRightPanel();
    expect(useAppStore.getState().rightPanelCollapsed).toBe(true);
  });

  it("sets and clears pending prompt", () => {
    const { setPendingPrompt } = useAppStore.getState();
    setPendingPrompt("hello");
    expect(useAppStore.getState().pendingPrompt).toBe("hello");
    setPendingPrompt(null);
    expect(useAppStore.getState().pendingPrompt).toBeNull();
  });

  it("persists only the partialize-listed fields", () => {
    const { setActiveWorkspace, setActiveSession, setLocale, toggleLeftSidebar, setPendingPrompt } =
      useAppStore.getState();
    setActiveWorkspace("ws-1");
    setActiveSession("s-1");
    setLocale("zh");
    setPendingPrompt("draft");
    toggleLeftSidebar();

    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    const state = stored.state ?? {};
    expect(state.activeWorkspaceId).toBe("ws-1");
    expect(state.locale).toBe("zh");
    expect(state.leftSidebarCollapsed).toBe(true);
    expect(state.activeSessionId).toBeUndefined();
    expect(state.pendingPrompt).toBeUndefined();
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
