import { useEffect, useState } from "react";
import type { Session, Workspace } from "@/api/client.js";
import { useApi } from "@/hooks/useApi.js";
import { cn } from "@/lib/cn.js";
import { Sidebar } from "@/sidebar/Sidebar.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "@/chat/ChatView.js";
import { NewThreadView } from "@/chat/NewThreadView.js";
import { DocumentPanel } from "@/documents/DocumentPanel.js";
import { Topbar } from "./Topbar.js";

export function AppShell({ serverUrl }: { serverUrl: string }) {
  const api = useApi(serverUrl);
  const view = useAppStore((s) => s.view);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const showRight = view === "chat" && !rightCollapsed && Boolean(activeWorkspaceId);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);

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

  useEffect(() => {
    if (!activeWorkspaceId) {
      setActiveWorkspace(null);
      return;
    }
    let alive = true;
    api
      .listWorkspaces()
      .then((list) => {
        if (alive) setActiveWorkspace(list.find((w) => w.id === activeWorkspaceId) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, activeWorkspaceId]);

  const title =
    view === "chat" && activeSession
      ? activeSession.title || "(untitled)"
      : activeWorkspace
        ? activeWorkspace.name
        : "";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar title={title} />
      <div
        className={cn(
          "grid min-h-0 flex-1 overflow-hidden",
          leftCollapsed && showRight && "grid-cols-[minmax(0,1fr)_320px]",
          leftCollapsed && !showRight && "grid-cols-[minmax(0,1fr)]",
          !leftCollapsed && showRight && "grid-cols-[240px_minmax(0,1fr)_320px]",
          !leftCollapsed && !showRight && "grid-cols-[240px_minmax(0,1fr)]"
        )}
      >
        {!leftCollapsed && (
          <aside aria-label="Sidebar" className="min-h-0 overflow-hidden">
            <Sidebar api={api} />
          </aside>
        )}
        <main className="min-h-0 overflow-hidden bg-background">
          {view === "chat" && activeSessionId ? (
            <ChatView api={api} sessionId={activeSessionId} />
          ) : (
            <NewThreadView api={api} />
          )}
        </main>
        {showRight && activeWorkspaceId && (
          <aside aria-label="Document panel" className="min-h-0 overflow-hidden border-l border-border">
            <DocumentPanel api={api} workspaceId={activeWorkspaceId} />
          </aside>
        )}
      </div>
    </div>
  );
}
