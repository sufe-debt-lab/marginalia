import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { SkillSelection } from "@/api/client.js";

export type AppView = "new-thread" | "chat" | "settings";
export type SettingsEntryTab = "general" | "skills";
export type Locale = "en" | "zh";
export type AgentPermission = "full" | "ask" | "readonly";
export type AgentReasoning = "low" | "medium" | "high" | "xhigh";

export type TurnDraft = {
  text: string;
  contextFiles: string[];
  skills: SkillSelection[];
};

export type PendingTurn = {
  sessionId: string;
  turn: TurnDraft;
};

export type TurnOwner = `session:${string}` | `new:${string}`;

interface AppState {
  view: AppView;
  locale: Locale;
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  activeSessionTitle: string | null;
  settingsEntryTab: SettingsEntryTab;
  settingsEntryRevision: number;
  turnDrafts: Partial<Record<TurnOwner, TurnDraft>>;
  pendingTurn: PendingTurn | null;
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  pinnedWorkspaceIds: string[];
  leftSidebarWidth: number;
  rightPanelWidth: number;
  // Composer model + agent controls — shared across NewThread and Chat.
  composerProviderId: string | null;
  composerModel: string | null;
  permission: AgentPermission;
  reasoning: AgentReasoning;
  resumeLastSession: boolean;

  setView: (v: AppView) => void;
  openSettings: (tab: SettingsEntryTab) => void;
  setLocale: (v: Locale) => void;
  setActiveWorkspace: (id: string | null) => void;
  setActiveSession: (id: string | null) => void;
  setActiveSessionTitle: (title: string | null) => void;
  getTurnDraft: (owner: TurnOwner) => TurnDraft;
  setTurnText: (owner: TurnOwner, text: string) => void;
  addTurnContextFile: (owner: TurnOwner, path: string) => void;
  removeTurnContextFile: (owner: TurnOwner, path: string) => void;
  addTurnSkill: (owner: TurnOwner, skill: SkillSelection) => void;
  removeTurnSkill: (owner: TurnOwner, path: string) => void;
  replaceTurnSkills: (owner: TurnOwner, skills: SkillSelection[]) => void;
  clearTurnDraft: (owner: TurnOwner) => void;
  moveTurnDraft: (from: TurnOwner, to: TurnOwner, submitted?: TurnDraft) => TurnDraft;
  setPendingTurn: (turn: PendingTurn | null) => void;
  claimPendingTurn: (sessionId: string) => TurnDraft | null;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  togglePin: (id: string) => void;
  removePin: (id: string) => void;
  setLeftSidebarWidth: (px: number) => void;
  setRightPanelWidth: (px: number) => void;
  setComposerModel: (providerId: string, model: string) => void;
  setPermission: (p: AgentPermission) => void;
  setReasoning: (r: AgentReasoning) => void;
  setResumeLastSession: (v: boolean) => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;
const MIN_RIGHT_WIDTH = 360;

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

function cloneTurnDraft(turn?: TurnDraft): TurnDraft {
  return {
    text: turn?.text ?? "",
    contextFiles: [...(turn?.contextFiles ?? [])],
    skills: (turn?.skills ?? []).map((skill) => ({ ...skill }))
  };
}

function dedupeSkills(skills: readonly SkillSelection[]): SkillSelection[] {
  const seen = new Set<string>();
  return skills.flatMap((skill) => {
    if (seen.has(skill.path)) return [];
    seen.add(skill.path);
    return [{ ...skill }];
  });
}

function sameTurnDraft(left: TurnDraft, right: TurnDraft): boolean {
  return (
    left.text === right.text &&
    left.contextFiles.length === right.contextFiles.length &&
    left.contextFiles.every((path, index) => path === right.contextFiles[index]) &&
    left.skills.length === right.skills.length &&
    left.skills.every(
      (skill, index) =>
        skill.name === right.skills[index]?.name && skill.path === right.skills[index]?.path
    )
  );
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      activeSessionTitle: null,
      settingsEntryTab: "general",
      settingsEntryRevision: 0,
      turnDrafts: {},
      pendingTurn: null,
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      pinnedWorkspaceIds: [],
      leftSidebarWidth: 275,
      rightPanelWidth: 388,
      composerProviderId: null,
      composerModel: null,
      permission: "full",
      reasoning: "medium",
      resumeLastSession: false,

      setView: (v) => set({ view: v }),
      openSettings: (tab) =>
        set((state) => ({
          view: "settings",
          settingsEntryTab: tab,
          settingsEntryRevision: state.settingsEntryRevision + 1
        })),
      setLocale: (v) => set({ locale: v }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setActiveSession: (id) =>
        set(
          id === null
            ? { activeSessionId: null, activeSessionTitle: null }
            : { activeSessionId: id }
        ),
      setActiveSessionTitle: (title) => set({ activeSessionTitle: title }),
      getTurnDraft: (owner) => cloneTurnDraft(get().turnDrafts[owner]),
      setTurnText: (owner, text) =>
        set((s) => ({
          turnDrafts: {
            ...s.turnDrafts,
            [owner]: { ...cloneTurnDraft(s.turnDrafts[owner]), text }
          }
        })),
      addTurnContextFile: (owner, path) =>
        set((s) => {
          const draft = cloneTurnDraft(s.turnDrafts[owner]);
          if (draft.contextFiles.includes(path)) return s;
          draft.contextFiles.push(path);
          return { turnDrafts: { ...s.turnDrafts, [owner]: draft } };
        }),
      removeTurnContextFile: (owner, path) =>
        set((s) => {
          const draft = cloneTurnDraft(s.turnDrafts[owner]);
          draft.contextFiles = draft.contextFiles.filter((item) => item !== path);
          return { turnDrafts: { ...s.turnDrafts, [owner]: draft } };
        }),
      addTurnSkill: (owner, skill) =>
        set((s) => {
          const draft = cloneTurnDraft(s.turnDrafts[owner]);
          if (draft.skills.some((item) => item.path === skill.path)) return s;
          draft.skills.push({ ...skill });
          return { turnDrafts: { ...s.turnDrafts, [owner]: draft } };
        }),
      removeTurnSkill: (owner, path) =>
        set((s) => {
          const draft = cloneTurnDraft(s.turnDrafts[owner]);
          draft.skills = draft.skills.filter((skill) => skill.path !== path);
          return { turnDrafts: { ...s.turnDrafts, [owner]: draft } };
        }),
      replaceTurnSkills: (owner, skills) =>
        set((s) => {
          const draft = cloneTurnDraft(s.turnDrafts[owner]);
          draft.skills = dedupeSkills(skills);
          return { turnDrafts: { ...s.turnDrafts, [owner]: draft } };
        }),
      clearTurnDraft: (owner) =>
        set((s) => {
          if (!(owner in s.turnDrafts)) return s;
          const turnDrafts = { ...s.turnDrafts };
          delete turnDrafts[owner];
          return { turnDrafts };
        }),
      moveTurnDraft: (from, to, submitted) => {
        let moved = cloneTurnDraft();
        set((s) => {
          const current = cloneTurnDraft(s.turnDrafts[from]);
          moved = cloneTurnDraft(submitted ?? current);
          const turnDrafts: Partial<Record<TurnOwner, TurnDraft>> = {
            ...s.turnDrafts,
            [to]: cloneTurnDraft(moved)
          };
          if (submitted === undefined || sameTurnDraft(current, submitted)) delete turnDrafts[from];
          return { turnDrafts };
        });
        return cloneTurnDraft(moved);
      },
      setPendingTurn: (pendingTurn) =>
        set({
          pendingTurn: pendingTurn
            ? { sessionId: pendingTurn.sessionId, turn: cloneTurnDraft(pendingTurn.turn) }
            : null
        }),
      claimPendingTurn: (sessionId) => {
        let claimed: TurnDraft | null = null;
        set((s) => {
          if (s.pendingTurn?.sessionId !== sessionId) return s;
          claimed = cloneTurnDraft(s.pendingTurn.turn);
          return { pendingTurn: null };
        });
        return claimed === null ? null : cloneTurnDraft(claimed);
      },
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
      setRightPanelWidth: (px) =>
        set({
          rightPanelWidth: Math.max(MIN_RIGHT_WIDTH, Math.round(px))
        }),
      setComposerModel: (providerId, model) =>
        set({ composerProviderId: providerId, composerModel: model }),
      setPermission: (p) => set({ permission: p }),
      setReasoning: (r) => set({ reasoning: r }),
      setResumeLastSession: (v) => set({ resumeLastSession: v })
    }),
    {
      name: "marginalia-app",
      version: 1,
      storage: createJSONStorage(() => localStorageAdapter),
      partialize: (s) => ({
        activeWorkspaceId: s.activeWorkspaceId,
        locale: s.locale,
        leftSidebarCollapsed: s.leftSidebarCollapsed,
        rightPanelCollapsed: s.rightPanelCollapsed,
        pinnedWorkspaceIds: s.pinnedWorkspaceIds,
        leftSidebarWidth: s.leftSidebarWidth,
        rightPanelWidth: s.rightPanelWidth,
        permission: s.permission,
        reasoning: s.reasoning,
        composerProviderId: s.composerProviderId,
        composerModel: s.composerModel,
        resumeLastSession: s.resumeLastSession
      })
    }
  )
);
