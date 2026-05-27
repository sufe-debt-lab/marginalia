import { useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useSessions } from "@/hooks/useSessions.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";

export function WorkspaceTree({ api, workspace }: { api: ApiClient; workspace: Workspace }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const sessions = useSessions(api, expanded ? workspace.id : null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setView = useAppStore((s) => s.setView);

  function selectSession(sessionId: string) {
    setActiveWorkspace(workspace.id);
    setActiveSession(sessionId);
    setView("chat");
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex min-w-0 w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-foreground/80 active:scale-[0.99] [@media(hover:hover)]:hover:bg-accent"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-90")} />
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left" title={workspace.name}>
          {workspace.name}
        </span>
      </button>
      {expanded && (
        <ul className="ml-6 mt-0.5 space-y-0.5">
          {sessions.loading && <li className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</li>}
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
    </div>
  );
}
