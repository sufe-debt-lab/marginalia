import { PanelLeft, PanelRight } from "lucide-react";
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
  const toggleLeft = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRight = useAppStore((s) => s.toggleRightPanel);

  return (
    <header
      className={cn(
        "app-drag flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-3",
        isMac && "pl-[88px]"
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="app-no-drag h-8 w-8 active:scale-95"
        aria-label={t("common.toggleLeftSidebar")}
        onClick={toggleLeft}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/80">{title}</div>
      {view === "chat" && (
        <Button
          variant="ghost"
          size="icon"
          className="app-no-drag h-8 w-8 active:scale-95"
          aria-label={t("common.toggleRightPanel")}
          onClick={toggleRight}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
    </header>
  );
}
