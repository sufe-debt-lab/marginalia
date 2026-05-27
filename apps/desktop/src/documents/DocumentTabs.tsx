import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn.js";

function basename(p: string): string {
  return p.split("/").pop() || p;
}

interface Props {
  tabs: readonly string[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
}

export function DocumentTabs({ tabs, activeTab, onSelect, onClose, onAdd }: Props) {
  return (
    <div className="flex h-9 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-2">
      {tabs.map((path) => (
        <div
          key={path}
          className={cn(
            "group flex h-7 items-center gap-1 rounded px-2 text-xs",
            activeTab === path
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:bg-background/60"
          )}
        >
          <button
            type="button"
            className="max-w-[160px] truncate"
            onClick={() => onSelect(path)}
          >
            {basename(path)}
          </button>
          <button
            type="button"
            aria-label={`Close ${path}`}
            onClick={() => onClose(path)}
            className="hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="Add tab"
        onClick={onAdd}
        className="ml-1 flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-background/60"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
