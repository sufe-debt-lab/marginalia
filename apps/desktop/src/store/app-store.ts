import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type AppView = "new-thread" | "chat" | "settings";
export type Locale = "en" | "zh";

interface AppState {
  view: AppView;
  locale: Locale;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  pendingPrompt: string | null;
  contextFiles: string[];
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  pinnedWorkspaceIds: string[];
  leftSidebarWidth: number;

  setView: (v: AppView) => void;
  setLocale: (v: Locale) => void;
  setActiveWorkspace: (id: string | null) => void;
  setActiveSession: (id: string | null) => void;
  setPendingPrompt: (p: string | null) => void;
  addContextFile: (p: string) => void;
  removeContextFile: (p: string) => void;
  clearContextFiles: () => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  togglePin: (id: string) => void;
  removePin: (id: string) => void;
  setLeftSidebarWidth: (px: number) => void;
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
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 240,

      setView: (v) => set({ view: v }),
      setLocale: (v) => set({ locale: v }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setActiveSession: (id) => set({ activeSessionId: id }),
      setPendingPrompt: (p) => set({ pendingPrompt: p }),
      addContextFile: (p) =>
        set((s) => (s.contextFiles.includes(p) ? s : { contextFiles: [...s.contextFiles, p] })),
      removeContextFile: (p) => set((s) => ({ contextFiles: s.contextFiles.filter((x) => x !== p) })),
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
        set({ leftSidebarWidth: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px))) })
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
        leftSidebarWidth: s.leftSidebarWidth
      })
    }
  )
);
