import { MessageSquare } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { useSessions } from "@/hooks/useSessions.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { relativeTime } from "@/lib/relative-time.js";
import { useAppStore } from "@/store/app-store.js";

const MAX_RECENT = 5;

/**
 * "Pick up where you left off" — recent sessions for the active workspace,
 * rendered below the NewThread composer (design: views.jsx NewThreadView).
 * Sessions arrive from the API ordered by updated_at desc.
 */
export function RecentThreads({ api }: { api: ApiClient }) {
  const { t, locale } = useTranslation();
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveSessionTitle = useAppStore((s) => s.setActiveSessionTitle);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setView = useAppStore((s) => s.setView);
  const sessions = useSessions(api, activeWorkspaceId);

  const recent = sessions.data.slice(0, MAX_RECENT);
  if (sessions.loading || recent.length === 0) return null;

  function open(workspaceId: string, sessionId: string, title: string) {
    setActiveWorkspace(workspaceId);
    setActiveSession(sessionId);
    setActiveSessionTitle(title || t("common.untitled"));
    setView("chat");
  }

  return (
    <div className="mt-9">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
        <span>{t("newThread.pickUp")}</span>
        <span className="h-px flex-1 bg-border-soft" />
      </div>
      <div className="flex flex-col">
        {recent.map((s, i) => {
          const meta = [s.updatedAt ? relativeTime(s.updatedAt, locale) : null, s.model || null]
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => open(s.workspaceId, s.id, s.title)}
              className={`flex items-center gap-3 px-1 py-2.5 text-left active:scale-[0.99] [@media(hover:hover)]:hover:bg-accent/50 ${
                i < recent.length - 1 ? "border-b border-border-soft" : ""
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {s.title || t("common.untitled")}
              </span>
              {meta && <span className="mono shrink-0 text-[11px] text-text-faint">{meta}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
