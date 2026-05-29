import { Info, PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";

const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform.toLowerCase().includes("mac") ||
    navigator.userAgent.toLowerCase().includes("macintosh"));

export function Topbar({ title }: { title: string }) {
  const { t } = useTranslation();
  const view = useAppStore((s) => s.view);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const toggleLeft = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRight = useAppStore((s) => s.toggleRightPanel);

  return (
    <header
      className={cn(
        "app-drag flex h-[38px] shrink-0 items-center gap-1 border-b border-border-soft bg-background px-2",
        isMac && "pl-[80px]"
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "app-no-drag h-7 w-7 text-text-muted active:scale-95",
          !leftCollapsed && "bg-surface-3 text-foreground"
        )}
        aria-pressed={!leftCollapsed}
        aria-label={t("common.toggleLeftSidebar")}
        onClick={toggleLeft}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 px-3 text-center">
        <span className="truncate text-xs font-medium text-text-muted">{title}</span>
        {view === "chat" && (
          <Button
            variant="ghost"
            size="icon"
            className="app-no-drag h-6 w-6 text-text-faint active:scale-95"
            aria-label={t("common.sessionInfo")}
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex items-center">
        {view === "chat" && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "app-no-drag h-7 w-7 text-text-muted active:scale-95",
              !rightCollapsed && "bg-surface-3 text-foreground"
            )}
            aria-pressed={!rightCollapsed}
            aria-label={t("common.toggleRightPanel")}
            onClick={toggleRight}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
