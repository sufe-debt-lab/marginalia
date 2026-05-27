import { useEffect } from "react";
import { FileText } from "lucide-react";

interface Props {
  suggestions: readonly { path: string }[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function MentionMenu({ suggestions, onSelect, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (suggestions.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 max-h-64 w-72 overflow-auto rounded-md border border-border bg-popover shadow-md">
      {suggestions.map((s) => (
        <button
          key={s.path}
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => onSelect(s.path)}
        >
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span className="truncate">{s.path}</span>
        </button>
      ))}
    </div>
  );
}
