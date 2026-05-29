import { useEffect } from "react";
import { useTranslation } from "@/i18n/useTranslation.js";

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (filtered.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-md">
      {filtered.map((c) => (
        <button
          key={c.name}
          type="button"
          className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
          onClick={() => onSelect(c.name)}
        >
          <span className="font-mono font-medium">/{c.name}</span>
          <span className="text-muted-foreground">{t(c.helpKey)}</span>
        </button>
      ))}
    </div>
  );
}
