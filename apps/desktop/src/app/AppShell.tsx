import { useEffect, useState } from "react";
import type { Session } from "@/api/client.js";
import { ResizeHandle } from "@/components/ResizeHandle.js";
import { useApi } from "@/hooks/useApi.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { Sidebar } from "@/sidebar/Sidebar.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "@/chat/ChatView.js";
import { NewThreadView } from "@/chat/NewThreadView.js";
import { DocumentPanel } from "@/documents/DocumentPanel.js";
import { SettingsView } from "@/settings/SettingsView.js";
import { Topbar } from "./Topbar.js";

export function AppShell({ serverUrl }: { serverUrl: string }) {
  const api = useApi(serverUrl);
  const { t } = useTranslation();
  const view = useAppStore((s) => s.view);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const leftWidth = useAppStore((s) => s.leftSidebarWidth);
  const setLeftWidth = useAppStore((s) => s.setLeftSidebarWidth);
  const showRight = view === "chat" && !rightCollapsed && Boolean(activeWorkspaceId);
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!activeSessionId || !activeWorkspaceId) {
      setActiveSession(null);
      return;
    }
    let alive = true;
    api
      .listSessions(activeWorkspaceId)
      .then((list) => {
        if (alive) setActiveSession(list.find((s) => s.id === activeSessionId) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, activeSessionId, activeWorkspaceId]);

  const title =
    view === "settings"
      ? t("settings.title")
      : view === "chat"
        ? activeSession?.title || t("common.untitled")
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
          ) : view === "chat" && activeSessionId ? (
            <ChatView api={api} sessionId={activeSessionId} />
          ) : (
            <NewThreadView api={api} />
          )}
        </main>
        {showRight && activeWorkspaceId && (
          <aside
            aria-label="Document panel"
            className="min-h-0 w-[388px] shrink-0 overflow-hidden border-l border-border-soft"
          >
            <DocumentPanel api={api} workspaceId={activeWorkspaceId} />
          </aside>
        )}
      </div>
    </div>
  );
}
