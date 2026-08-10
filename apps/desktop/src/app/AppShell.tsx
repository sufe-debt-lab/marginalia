import { useEffect, useMemo, useState } from "react";
import { ResizeHandle } from "@/components/ResizeHandle.js";
import { useApi } from "@/hooks/useApi.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { Sidebar } from "@/sidebar/Sidebar.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "@/chat/ChatView.js";
import { FirstRunView } from "@/chat/FirstRunView.js";
import { NewThreadView } from "@/chat/NewThreadView.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { DocumentPanel } from "@/documents/DocumentPanel.js";
import { SettingsView } from "@/settings/SettingsView.js";
import { Topbar } from "./Topbar.js";

export function AppShell({ serverUrl }: { serverUrl: string }) {
  const api = useApi(serverUrl);
  const { t } = useTranslation();
  const view = useAppStore((s) => s.view);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeSessionTitle = useAppStore((s) => s.activeSessionTitle);
  const settingsEntryTab = useAppStore((s) => s.settingsEntryTab);
  const settingsEntryRevision = useAppStore((s) => s.settingsEntryRevision);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const leftWidth = useAppStore((s) => s.leftSidebarWidth);
  const setLeftWidth = useAppStore((s) => s.setLeftSidebarWidth);
  // Lazy-mount the sidebar: a session that starts collapsed pays no fetch cost,
  // but once opened the content stays mounted so the collapse can animate.
  const [sidebarOpenedOnce, setSidebarOpenedOnce] = useState(!leftCollapsed);
  useEffect(() => {
    if (!leftCollapsed) setSidebarOpenedOnce(true);
  }, [leftCollapsed]);
  const rightWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightWidth = useAppStore((s) => s.setRightPanelWidth);
  const workspaces = useWorkspaces(api);
  const noWorkspaces = !workspaces.loading && workspaces.data.length === 0;
  const activeWorkspace = useMemo(
    () => workspaces.data.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [workspaces.data, activeWorkspaceId]
  );
  const activeWorkspaceName = activeWorkspace?.name ?? null;
  const showRight = view === "chat" && !rightCollapsed && Boolean(activeWorkspaceId);

  const title =
    view === "settings"
      ? t("settings.title")
      : view === "chat"
        ? activeSessionTitle || t("common.untitled")
        : t("newThread.tabTitle");

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar title={title} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="Sidebar"
          aria-hidden={leftCollapsed}
          data-collapsed={leftCollapsed}
          style={{ width: leftCollapsed ? 0 : leftWidth }}
          className="sidebar-pane relative min-h-0 shrink-0 overflow-hidden"
        >
          <div style={{ width: leftWidth }} className="h-full">
            {sidebarOpenedOnce && <Sidebar api={api} />}
          </div>
          {!leftCollapsed && (
            <ResizeHandle side="right" getWidth={() => leftWidth} onWidth={setLeftWidth} />
          )}
        </aside>
        <main className="min-h-0 flex-1 overflow-hidden bg-background">
          {view === "settings" ? (
            <SettingsView
              key={settingsEntryRevision}
              api={api}
              initialTab={settingsEntryTab}
              skillsWorkspace={
                activeWorkspace ? { id: activeWorkspace.id, name: activeWorkspace.name } : null
              }
            />
          ) : noWorkspaces ? (
            <FirstRunView api={api} />
          ) : view === "chat" && activeSessionId ? (
            <ChatView key={activeSessionId} api={api} sessionId={activeSessionId} />
          ) : (
            <NewThreadView api={api} />
          )}
        </main>
        {showRight && activeWorkspaceId && (
          <aside
            aria-label="Document panel"
            style={{ width: rightWidth }}
            className="pane-width-transition relative min-h-0 shrink-0 overflow-hidden border-l border-border"
          >
            <ResizeHandle side="left" getWidth={() => rightWidth} onWidth={setRightWidth} />
            <DocumentPanel
              api={api}
              workspaceId={activeWorkspaceId}
              workspaceName={activeWorkspaceName}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
