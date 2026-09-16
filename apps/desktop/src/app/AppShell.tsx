import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
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

// Walk open shadow roots as well as light DOM so the file-tree web component
// participates in the same native Tab sequence as the panel toolbar.
function panelTabStops(root: Element | ShadowRoot): HTMLElement[] {
  return Array.from(root.children).flatMap((child) => {
    if (!(child instanceof HTMLElement)) return [];
    if (child.matches('[inert], [hidden], [aria-hidden="true"]')) return [];
    const style = window.getComputedStyle(child);
    if (style.display === "none" || style.visibility === "hidden") return [];
    const self = child.tabIndex >= 0 && !child.matches(":disabled") ? [child] : [];
    return [...self, ...panelTabStops(child.shadowRoot ?? child)];
  });
}

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

  const [rightDragWidth, setRightDragWidth] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const dragStart = useRef(rightWidth);
  const panelRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const isFullscreen = fullscreen && showRight;
  const visibleLeftWidth = Math.min(leftWidth, Math.max(180, viewportWidth - 160));
  const visibleRightWidth = Math.min(Math.max(360, rightDragWidth ?? rightWidth), viewportWidth);

  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!showRight) setFullscreen(false);
    if (topbarRef.current) topbarRef.current.inert = isFullscreen;
    if (mainRef.current) mainRef.current.inert = isFullscreen;
    if (sidebarRef.current) sidebarRef.current.inert = isFullscreen || leftCollapsed;
    if (panelRef.current) panelRef.current.inert = !showRight;
    if (isFullscreen) expandRef.current?.focus();
  }, [isFullscreen, showRight, leftCollapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b" && !isFullscreen) {
        event.preventDefault();
        useAppStore.getState().toggleLeftSidebar();
      }
      if (isFullscreen && event.key === "Escape") {
        event.preventDefault();
        setFullscreen(false);
        expandRef.current?.focus();
      }
      if (isFullscreen && event.key === "Tab") {
        const items = panelRef.current ? panelTabStops(panelRef.current) : [];
        const active = event.composedPath()[0];
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  function resizeRight(width: number) {
    if (width >= viewportWidth - 2) {
      setRightDragWidth(null);
      setFullscreen(true);
    } else setRightDragWidth(Math.max(360, width));
  }

  const title =
    view === "settings"
      ? t("settings.title")
      : view === "chat"
        ? activeSessionTitle || t("common.untitled")
        : t("newThread.tabTitle");

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div ref={topbarRef}>
        <Topbar title={title} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          ref={sidebarRef}
          aria-label={t("common.sidebar")}
          aria-hidden={leftCollapsed}
          data-collapsed={leftCollapsed}
          style={{ width: leftCollapsed ? 0 : visibleLeftWidth }}
          className="sidebar-pane relative min-h-0 shrink-0 overflow-hidden"
        >
          <div style={{ width: visibleLeftWidth }} className="h-full">
            {sidebarOpenedOnce && <Sidebar api={api} />}
          </div>
          {!leftCollapsed && (
            <ResizeHandle side="right" getWidth={() => leftWidth} onWidth={setLeftWidth} />
          )}
        </aside>
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
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
        <div
          aria-hidden="true"
          className="pane-width-transition shrink-0"
          style={{
            width: showRight
              ? Math.min(visibleRightWidth, viewportWidth - (leftCollapsed ? 0 : visibleLeftWidth))
              : 0
          }}
        />
        {activeWorkspaceId && (
          <aside
            ref={panelRef}
            role={isFullscreen ? "dialog" : undefined}
            aria-modal={isFullscreen ? true : undefined}
            aria-label={t("common.documentPanel")}
            aria-hidden={!showRight}
            data-collapsed={!showRight}
            style={{ width: isFullscreen ? "100%" : showRight ? visibleRightWidth : 0 }}
            className={`sidebar-pane document-pane min-h-0 shrink-0 overflow-hidden bg-background ${isFullscreen ? "fixed inset-0 z-50" : "absolute bottom-0 right-0 top-[46px]"}`}
          >
            {!isFullscreen && (
              <ResizeHandle
                side="left"
                getWidth={() => visibleRightWidth}
                onStart={() => {
                  dragStart.current = visibleRightWidth;
                  setRightDragWidth(visibleRightWidth);
                }}
                onWidth={resizeRight}
                onCommit={(width) => {
                  if (width < viewportWidth - 2 && width !== dragStart.current)
                    setRightWidth(width);
                  setRightDragWidth(null);
                }}
              />
            )}
            <div
              className={`panel-toolbar app-drag flex h-[46px] shrink-0 items-center justify-end gap-1 px-2 ${isFullscreen ? "pl-[80px]" : ""}`}
            >
              <button
                ref={expandRef}
                className="icon-action app-no-drag"
                aria-label={t(isFullscreen ? "common.restorePanel" : "common.expandPanel")}
                onClick={() => setFullscreen(!isFullscreen)}
              >
                {isFullscreen ? <Minimize2 /> : <Maximize2 />}
              </button>
              <button
                className="icon-action app-no-drag"
                aria-label={t("common.closePanel")}
                onClick={() => {
                  setFullscreen(false);
                  useAppStore.getState().toggleRightPanel();
                  requestAnimationFrame(() =>
                    topbarRef.current
                      ?.querySelector<HTMLButtonElement>("[data-panel-toggle]")
                      ?.focus()
                  );
                }}
              >
                <X />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <DocumentPanel
                key={activeWorkspaceId}
                api={api}
                workspaceId={activeWorkspaceId}
                workspaceName={activeWorkspaceName}
                visible={showRight}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
