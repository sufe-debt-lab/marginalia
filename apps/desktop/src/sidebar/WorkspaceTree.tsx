import { useState } from "react";
import { ChevronRight, Folder, Pin } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useSessions } from "@/hooks/useSessions.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { WorkspaceActions } from "./WorkspaceActions.js";

interface Props {
  api: ApiClient;
  workspace: Workspace;
  onDelete: (id: string) => Promise<void>;
}

export function WorkspaceTree({ api, workspace, onDelete }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const sessions = useSessions(api, expanded ? workspace.id : null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setView = useAppStore((s) => s.setView);
  const togglePin = useAppStore((s) => s.togglePin);
  const removePin = useAppStore((s) => s.removePin);
  const isPinned = useAppStore((s) => s.pinnedWorkspaceIds.includes(workspace.id));

  function selectSession(sessionId: string) {
    setActiveWorkspace(workspace.id);
    setActiveSession(sessionId);
    setView("chat");
  }

  async function confirmDelete() {
    try {
      await onDelete(workspace.id);
      removePin(workspace.id);
      if (activeWorkspaceId === workspace.id) {
        setActiveWorkspace(null);
        setActiveSession(null);
      }
      setDeleteOpen(false);
    } catch (err) {
      toast.error(`Failed to delete: ${(err as Error).message}`);
    }
  }

  return (
    <div>
      <WorkspaceActions
        workspace={workspace}
        pinned={isPinned}
        onPin={togglePin}
        onDelete={() => setDeleteOpen(true)}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-foreground/80 active:scale-[0.99] [@media(hover:hover)]:hover:bg-accent"
        >
          <ChevronRight
            className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
          />
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left" title={workspace.name}>
            {workspace.name}
          </span>
          {isPinned && (
            <Pin aria-label="pinned" className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </button>
      </WorkspaceActions>
      {expanded && (
        <ul className="ml-6 mt-0.5 space-y-0.5">
          {sessions.loading && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</li>
          )}
          {!sessions.loading && sessions.data.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{t("common.noChats")}</li>
          )}
          {sessions.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => selectSession(s.id)}
                className={cn(
                  "w-full truncate rounded-md px-2 py-1 text-left text-sm text-foreground/70 active:scale-[0.99] [@media(hover:hover)]:hover:bg-accent",
                  activeSessionId === s.id && "bg-accent text-foreground"
                )}
              >
                {s.title || t("common.untitled")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDeleteDialog
        open={deleteOpen}
        workspaceName={workspace.name}
        onConfirm={confirmDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
