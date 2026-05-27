import { useApi } from "@/hooks/useApi.js";
import { cn } from "@/lib/cn.js";
import { Sidebar } from "@/sidebar/Sidebar.js";
import { useAppStore } from "@/store/app-store.js";
import { MainPlaceholder, DocumentPanelPlaceholder } from "./placeholders.js";
import { Topbar } from "./Topbar.js";

export function AppShell({ serverUrl }: { serverUrl: string }) {
  const api = useApi(serverUrl);
  const view = useAppStore((s) => s.view);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const showRight = view === "chat" && !rightCollapsed;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar title="" />
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
          <MainPlaceholder view={view} />
        </main>
        {showRight && (
          <aside aria-label="Document panel" className="min-h-0 overflow-hidden border-l border-border">
            <DocumentPanelPlaceholder />
          </aside>
        )}
      </div>
    </div>
  );
}
