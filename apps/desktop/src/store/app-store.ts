import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type AppView = "new-thread" | "chat" | "settings";
export type Locale = "en" | "zh";
export type AgentPermission = "full" | "ask" | "readonly";
export type AgentReasoning = "low" | "medium" | "high" | "xhigh";

interface AppState {
  view: AppView;
  locale: Locale;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  pendingPrompt: string | null;
  contextFiles: string[];
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  pinnedWorkspaceIds: string[];
  leftSidebarWidth: number;
  // Composer model + agent controls — shared across NewThread and Chat.
  composerProviderId: string | null;
  composerModel: string | null;
  permission: AgentPermission;
  reasoning: AgentReasoning;
  resumeLastSession: boolean;

  setView: (v: AppView) => void;
  setLocale: (v: Locale) => void;
  setActiveWorkspace: (id: string | null) => void;
  setActiveSession: (id: string | null) => void;
  setActiveSessionTitle: (title: string | null) => void;
  setPendingPrompt: (p: string | null) => void;
  addContextFile: (p: string) => void;
  removeContextFile: (p: string) => void;
  clearContextFiles: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  togglePin: (id: string) => void;
  removePin: (id: string) => void;
  setLeftSidebarWidth: (px: number) => void;
  setComposerModel: (providerId: string, model: string) => void;
  setPermission: (p: AgentPermission) => void;
  setReasoning: (r: AgentReasoning) => void;
  setResumeLastSession: (v: boolean) => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

const localStorageAdapter: StateStorage = {
  getItem: (name) => getLocalStorage()?.getItem(name) ?? null,
  setItem: (name, value) => getLocalStorage()?.setItem(name, value),
  removeItem: (name) => getLocalStorage()?.removeItem(name)
};

function getLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      activeSessionTitle: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 240,
      composerProviderId: null,
      composerModel: null,
      permission: "full",
      reasoning: "medium",
      resumeLastSession: false,

      setView: (v) => set({ view: v }),
      setLocale: (v) => set({ locale: v }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setActiveSession: (id) =>
        set(
          id === null
            ? { activeSessionId: null, activeSessionTitle: null }
            : { activeSessionId: id }
        ),
      setActiveSessionTitle: (title) => set({ activeSessionTitle: title }),
      setPendingPrompt: (p) => set({ pendingPrompt: p }),
      addContextFile: (p) =>
        set((s) => (s.contextFiles.includes(p) ? s : { contextFiles: [...s.contextFiles, p] })),
      removeContextFile: (p) =>
        set((s) => ({ contextFiles: s.contextFiles.filter((x) => x !== p) })),
      clearContextFiles: () => set({ contextFiles: [] }),
      toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      togglePin: (id) =>
        set((s) => {
          const exists = s.pinnedWorkspaceIds.includes(id);
          return {
            pinnedWorkspaceIds: exists
              ? s.pinnedWorkspaceIds.filter((x) => x !== id)
              : [...s.pinnedWorkspaceIds, id]
          };
        }),
      removePin: (id) =>
        set((s) => ({
          pinnedWorkspaceIds: s.pinnedWorkspaceIds.filter((x) => x !== id)
        })),
      setLeftSidebarWidth: (px) =>
        set({ leftSidebarWidth: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px))) }),
      setComposerModel: (providerId, model) =>
        set({ composerProviderId: providerId, composerModel: model }),
      setPermission: (p) => set({ permission: p }),
      setReasoning: (r) => set({ reasoning: r }),
      setResumeLastSession: (v) => set({ resumeLastSession: v })
    }),
    {
      name: "my-cowork-app",
      version: 1,
      storage: createJSONStorage(() => localStorageAdapter),
      partialize: (s) => ({
        activeWorkspaceId: s.activeWorkspaceId,
        locale: s.locale,
        leftSidebarCollapsed: s.leftSidebarCollapsed,
        rightPanelCollapsed: s.rightPanelCollapsed,
        pinnedWorkspaceIds: s.pinnedWorkspaceIds,
        leftSidebarWidth: s.leftSidebarWidth,
        permission: s.permission,
        reasoning: s.reasoning,
        composerProviderId: s.composerProviderId,
        composerModel: s.composerModel,
        resumeLastSession: s.resumeLastSession
      })
    }
  )
);
