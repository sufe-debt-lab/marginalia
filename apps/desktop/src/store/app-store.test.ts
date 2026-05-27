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
      rightPanelCollapsed: false
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

    const stored = JSON.parse(localStorage.getItem("my-cowork-app") || "{}");
    const state = stored.state ?? {};
    expect(state.activeWorkspaceId).toBe("ws-1");
    expect(state.locale).toBe("zh");
    expect(state.leftSidebarCollapsed).toBe(true);
    expect(state.activeSessionId).toBeUndefined();
    expect(state.pendingPrompt).toBeUndefined();
    expect(state.view).toBeUndefined();
  });
});
