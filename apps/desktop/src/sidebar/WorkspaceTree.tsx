import { useState } from "react";
import { Folder, Pin } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useSessions } from "@/hooks/useSessions.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { relativeTime } from "@/lib/relative-time.js";
import { useAppStore } from "@/store/app-store.js";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";
import { WorkspaceActions } from "./WorkspaceActions.js";

interface Props {
  api: ApiClient;
  workspace: Workspace;
  onDelete: (id: string) => Promise<void>;
}

/** Sessions shown per workspace before the list folds behind "Show more". */
const VISIBLE_SESSIONS = 5;

export function WorkspaceTree({ api, workspace, onDelete }: Props) {
  const { t, locale } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const sessions = useSessions(api, workspace.id);
  const visibleSessions = showAll ? sessions.data : sessions.data.slice(0, VISIBLE_SESSIONS);
  const hiddenCount = sessions.data.length - visibleSessions.length;
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveSessionTitle = useAppStore((s) => s.setActiveSessionTitle);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setView = useAppStore((s) => s.setView);
  const togglePin = useAppStore((s) => s.togglePin);
  const removePin = useAppStore((s) => s.removePin);
  const isPinned = useAppStore((s) => s.pinnedWorkspaceIds.includes(workspace.id));

  function selectSession(sessionId: string, sessionTitle: string) {
    setActiveWorkspace(workspace.id);
    setActiveSession(sessionId);
    setActiveSessionTitle(sessionTitle || t("common.untitled"));
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
          className="flex min-w-0 w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 active:scale-[0.99] [@media(hover:hover)]:hover:bg-accent"
        >
          <Folder className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate text-left" title={workspace.name}>
            {workspace.name}
          </span>
          {isPinned && (
            <Pin
              aria-label={t("common.pinned")}
              className="h-3 w-3 shrink-0 text-muted-foreground"
            />
          )}
        </button>
      </WorkspaceActions>
      <div className="reveal" data-open={expanded ? "true" : undefined} aria-hidden={!expanded}>
        {/* preflight is off — reset the UA list padding/margin explicitly */}
        <ul className="m-0 list-none space-y-px overflow-hidden p-0 pb-1">
          {sessions.loading && (
            <li className="py-1 pl-[30px] pr-2 text-xs text-muted-foreground">
              {t("common.loading")}
            </li>
          )}
          {!sessions.loading && sessions.data.length === 0 && (
            <li className="py-1 pl-[30px] pr-2 text-xs text-muted-foreground">
              {t("common.noChats")}
            </li>
          )}
          {visibleSessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => selectSession(s.id, s.title)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md py-1.5 pl-[30px] pr-2 text-left text-sm text-foreground/70 active:scale-[0.99] [@media(hover:hover)]:hover:bg-accent",
                  activeSessionId === s.id && "bg-select text-foreground"
                )}
              >
                <span className="min-w-0 flex-1 truncate">{s.title || t("common.untitled")}</span>
                {s.updatedAt && (
                  <span className="mono shrink-0 text-[10.5px] text-text-faint">
                    {relativeTime(s.updatedAt, locale)}
                  </span>
                )}
              </button>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="flex w-full items-center rounded-md py-1.5 pl-[30px] pr-2 text-left text-sm text-text-subtle transition-colors motion-fast hover:text-foreground [@media(hover:hover)]:hover:bg-accent"
              >
                {t("common.showMore")}
              </button>
            </li>
          )}
        </ul>
      </div>
      <ConfirmDeleteDialog
        open={deleteOpen}
        workspaceName={workspace.name}
        onConfirm={confirmDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
