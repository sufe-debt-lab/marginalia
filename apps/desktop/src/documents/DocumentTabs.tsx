import { FileText, Folder, X } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";

export function basename(p: string): string {
  return p.split("/").pop() || p;
}

export interface Tab {
  path: string;
  pinned: boolean;
}

interface Props {
  tabs: readonly Tab[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onPin: (path: string) => void;
  workspaceName?: string | null;
}

export function DocumentTabs({ tabs, activeTab, onSelect, onClose, onPin, workspaceName }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[38px] items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-surface-2 px-2">
      {tabs.length === 0 && (
        <div className="flex items-center gap-2 px-2 text-[12.5px] font-medium text-text-muted">
          <Folder className="h-3.5 w-3.5" />
          <span className="max-w-[160px] truncate">{workspaceName ?? t("docPanel.files")}</span>
          <span className="text-text-faint">·</span>
          <span>{t("docPanel.files")}</span>
        </div>
      )}
      {tabs.map((tab) => {
        const active = activeTab === tab.path;
        return (
          <div
            key={tab.path}
            className={cn(
              "group -mb-px flex h-7 items-center gap-1.5 rounded-t-[7px] border px-2.5 text-xs",
              active
                ? "border-border bg-surface text-foreground"
                : "border-transparent text-text-muted hover:bg-surface/60",
              !tab.pinned && "italic"
            )}
          >
            <FileText className="h-3 w-3 shrink-0 text-text-faint" />
            <button
              type="button"
              className="max-w-[140px] truncate"
              onClick={() => onSelect(tab.path)}
              onDoubleClick={() => onPin(tab.path)}
            >
              {basename(tab.path)}
            </button>
            <button
              type="button"
              aria-label={`${t("docPanel.close")} ${tab.path}`}
              onClick={() => onClose(tab.path)}
              className="text-text-faint hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
