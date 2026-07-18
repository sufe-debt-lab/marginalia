import { useEffect } from "react";
import { PenSquare, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";
import { WorkspaceTree } from "./WorkspaceTree.js";

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "workspace";
}

export function Sidebar({ api }: { api: ApiClient }) {
  const { t } = useTranslation();
  const workspaces = useWorkspaces(api);
  const view = useAppStore((s) => s.view);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setView = useAppStore((s) => s.setView);
  const openSettings = useAppStore((s) => s.openSettings);
  const pinnedIds = useAppStore((s) => s.pinnedWorkspaceIds);

  const pinnedSet = new Set(pinnedIds);
  const pinnedList = workspaces.data
    .filter((w) => pinnedSet.has(w.id))
    .sort((a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id));
  const otherList = workspaces.data.filter((w) => !pinnedSet.has(w.id));

  useEffect(() => {
    if (workspaces.loading) return;
    const exists = workspaces.data.some((w) => w.id === activeWorkspaceId);
    if (!activeWorkspaceId || !exists) {
      setActiveWorkspace(workspaces.data[0]?.id ?? null);
    }
  }, [activeWorkspaceId, setActiveWorkspace, workspaces.data, workspaces.loading]);

  async function newWorkspace() {
    const picked = await window.marginalia?.pickWorkspaceDirectory?.();
    if (!picked) return;
    try {
      const created = await workspaces.create({ name: basename(picked), rootDir: picked });
      setActiveWorkspace(created.id);
      toast.success(`${t("toast.workspaceCreated")}: ${created.name}`);
    } catch (err) {
      toast.error(`${t("toast.createWorkspaceFailed")}: ${(err as Error).message}`);
    }
  }

  function newChat() {
    setActiveSession(null);
    setView("new-thread");
  }

  return (
    <aside className="flex h-full flex-col border-r border-border bg-surface-2">
      <div className="space-y-1 p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 rounded-md active:scale-[0.99]"
          onClick={newChat}
          aria-label={t("common.newChat")}
        >
          <PenSquare className="h-4 w-4" />
          {t("common.newChat")}
        </Button>
      </div>
      <div className="flex items-center justify-between px-3 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint">
        <span>{t("common.workspaces")}</span>
        <button
          type="button"
          onClick={newWorkspace}
          aria-label={t("common.newWorkspace")}
          className="rounded-md p-1 active:scale-95 [@media(hover:hover)]:hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <ScrollArea className="flex-1 px-2 pb-2">
        <div className="space-y-0.5 pt-1">
          {workspaces.loading && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</p>
          )}
          {!workspaces.loading && workspaces.data.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("common.noWorkspaces")}</p>
          )}
          {pinnedList.length > 0 && (
            <>
              <div className="px-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint">
                {t("common.pinned")}
              </div>
              {pinnedList.map((w) => (
                <WorkspaceTree key={w.id} api={api} workspace={w} onDelete={workspaces.remove} />
              ))}
              {otherList.length > 0 && <div className="my-1 border-t border-border" />}
            </>
          )}
          {otherList.map((w) => (
            <WorkspaceTree key={w.id} api={api} workspace={w} onDelete={workspaces.remove} />
          ))}
        </div>
      </ScrollArea>
      <div className="border-t border-border-soft p-2">
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2 rounded-md active:scale-[0.99]",
            view === "settings" && "bg-select text-foreground"
          )}
          onClick={() => openSettings("general")}
          aria-label={t("common.settings")}
        >
          <Settings className="h-4 w-4" />
          {t("common.settings")}
        </Button>
      </div>
    </aside>
  );
}
