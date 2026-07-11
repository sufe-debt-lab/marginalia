import { List } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation.js";

export type TocItem = { level: number; text: string; line: number };

export function extractHeadings(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inCode = false;
  markdown.split("\n").forEach((raw, index) => {
    if (raw.trimStart().startsWith("```")) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    const match = /^(#{1,4})\s+(.+)$/.exec(raw);
    if (match && match[1] && match[2]) {
      items.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
    }
  });
  return items;
}

export function MessageToc({ items, prefix }: { items: TocItem[]; prefix: string }) {
  const { t } = useTranslation();
  return (
    <nav className="mb-2 rounded-lg border border-soft bg-surface px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        <List className="h-3 w-3" />
        {t("chat.outline")}
      </span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={`${item.line}`} style={{ paddingLeft: (item.level - 1) * 8 }}>
            <button
              type="button"
              className="text-left text-[12px] text-text-muted hover:text-brand"
              onClick={() =>
                document
                  .getElementById(`${prefix}-h-${item.line}`)
                  ?.scrollIntoView({ block: "start", behavior: "smooth" })
              }
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
