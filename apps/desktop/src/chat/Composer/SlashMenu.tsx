import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { COMPOSER_MENU_CLS, useMenuNav } from "./useMenuNav.js";

const COMMANDS = [
  { name: "clear", helpKey: "composer.slashClear" },
  { name: "help", helpKey: "composer.slashHelp" },
  { name: "model", helpKey: "composer.slashModel" }
] as const;

interface Props {
  query: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

export function SlashMenu({ query, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const filtered = COMMANDS.filter((c) => c.name.startsWith(query.toLowerCase()));
  const { activeIndex, setActiveIndex } = useMenuNav(
    filtered,
    (c) => onSelect(c.name),
    onClose,
    query
  );

  if (filtered.length === 0) return null;
  return (
    <div role="listbox" className={cn(COMPOSER_MENU_CLS, "w-64 overflow-hidden")}>
      {filtered.map((c, index) => (
        <button
          key={c.name}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex w-full items-baseline gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent",
            index === activeIndex && "bg-accent text-accent-foreground"
          )}
          onClick={() => onSelect(c.name)}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <span className="font-mono font-medium">/{c.name}</span>
          <span className="text-muted-foreground">{t(c.helpKey)}</span>
        </button>
      ))}
    </div>
  );
}
