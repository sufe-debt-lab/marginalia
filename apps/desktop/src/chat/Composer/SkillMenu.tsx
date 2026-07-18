import { useTranslation } from "@/i18n/useTranslation.js";
import type { SkillPickerItem } from "@/hooks/useSkillCatalog.js";
import { cn } from "@/lib/cn.js";
import { COMPOSER_MENU_CLS, useMenuNav } from "./useMenuNav.js";

interface Props {
  items: readonly SkillPickerItem[];
  query: string;
  loading: boolean;
  error: Error | null;
  onSelect: (skill: SkillPickerItem) => void;
  onRetry: () => void;
  onClose: () => void;
}

function matches(item: SkillPickerItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return (
    item.name.toLocaleLowerCase().includes(normalized) ||
    item.description?.toLocaleLowerCase().includes(normalized) === true
  );
}

export function SkillMenu({ items, query, loading, error, onSelect, onRetry, onClose }: Props) {
  const { t } = useTranslation();
  const filtered = loading || error ? [] : items.filter((item) => matches(item, query));
  const resetKey = `${query}\0${filtered.map((item) => item.canonicalPath).join("\0")}`;
  const { activeIndex, setActiveIndex } = useMenuNav(filtered, onSelect, onClose, resetKey);

  return (
    <div
      role="listbox"
      aria-label={t("composer.skillsSection")}
      className={cn(COMPOSER_MENU_CLS, "max-h-[190px] w-80 overflow-auto")}
    >
      <div className="px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-subtle">
        {t("composer.skillsSection")}
      </div>
      {loading ? (
        <MenuStatus>{t("common.loading")}</MenuStatus>
      ) : error ? (
        <div className="flex min-h-10 items-center justify-between gap-3 px-2.5 py-2 text-xs text-text-muted">
          <span>{t("composer.skillsRefreshFailed")}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md px-2 py-1 font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <MenuStatus>{t("composer.noSkills")}</MenuStatus>
      ) : (
        filtered.map((item, index) => (
          <button
            key={item.canonicalPath}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              index === activeIndex && "bg-accent text-accent-foreground"
            )}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs font-medium">${item.name}</span>
              {item.description && (
                <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                  {item.description}
                </span>
              )}
            </span>
            <span className="shrink-0 text-[10px] text-text-subtle">{t("composer.skillType")}</span>
          </button>
        ))
      )}
    </div>
  );
}

function MenuStatus({ children }: { children: string }) {
  return (
    <div className="flex min-h-10 items-center px-2.5 py-2 text-xs text-text-muted">{children}</div>
  );
}
