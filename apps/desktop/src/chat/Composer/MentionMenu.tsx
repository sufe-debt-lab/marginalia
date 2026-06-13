import { FileText } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { COMPOSER_MENU_CLS, useMenuNav } from "./useMenuNav.js";

interface Props {
  suggestions: readonly { path: string }[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function MentionMenu({ suggestions, onSelect, onClose }: Props) {
  const { activeIndex, setActiveIndex } = useMenuNav(
    suggestions,
    (s) => onSelect(s.path),
    onClose,
    suggestions
  );

  if (suggestions.length === 0) return null;
  return (
    <div role="listbox" className={cn(COMPOSER_MENU_CLS, "max-h-[264px] w-80 overflow-auto")}>
      {suggestions.map((s, index) => (
        <button
          key={s.path}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-accent",
            index === activeIndex && "bg-accent text-accent-foreground"
          )}
          onClick={() => onSelect(s.path)}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <span className="truncate">{s.path}</span>
        </button>
      ))}
    </div>
  );
}
