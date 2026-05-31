import { useMemo } from "react";
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
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const leftWidth = useAppStore((s) => s.leftSidebarWidth);
  const setLeftWidth = useAppStore((s) => s.setLeftSidebarWidth);
  const rightWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightWidth = useAppStore((s) => s.setRightPanelWidth);
  const workspaces = useWorkspaces(api);
  const noWorkspaces = !workspaces.loading && workspaces.data.length === 0;
  const activeWorkspaceName = useMemo(
    () => workspaces.data.find((w) => w.id === activeWorkspaceId)?.name ?? null,
    [workspaces.data, activeWorkspaceId]
  );
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
        {!leftCollapsed && (
          <aside
            aria-label="Sidebar"
            style={{ width: leftWidth }}
            className="pane-width-transition relative min-h-0 shrink-0 overflow-hidden"
          >
            <Sidebar api={api} />
            <ResizeHandle side="right" getWidth={() => leftWidth} onWidth={setLeftWidth} />
          </aside>
        )}
        <main className="min-h-0 flex-1 overflow-hidden bg-background">
          {view === "settings" ? (
            <SettingsView api={api} />
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
            className="pane-width-transition relative min-h-0 shrink-0 overflow-hidden border-l border-border-soft"
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
