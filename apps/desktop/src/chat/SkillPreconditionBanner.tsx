import { RefreshCw, Settings, X } from "lucide-react";
import type { InvalidSkillSelection } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";

export type SkillPreconditionBannerProps = {
  invalidSelections: readonly InvalidSkillSelection[];
  refreshing: boolean;
  onRefresh(): void;
  onRemove(path: string): void;
  onOpenSettings(): void;
};

export function SkillPreconditionBanner({
  invalidSelections,
  refreshing,
  onRefresh,
  onRemove,
  onOpenSettings
}: SkillPreconditionBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="alert"
      className="mb-2.5 rounded-lg border border-warn bg-warn-soft px-2.5 py-2 text-xs text-warn"
    >
      <div className="font-medium">{t("composer.skillPreconditionTitle")}</div>
      <div className="mt-0.5 text-text-muted">{t("composer.skillPreconditionDescription")}</div>
      {invalidSelections.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {invalidSelections.map((selection) => (
            <button
              key={`${selection.path}\0${selection.name}`}
              type="button"
              aria-label={`${t("composer.removeUnavailableSkill")} ${selection.name}`}
              onClick={() => onRemove(selection.path)}
              className="flex min-h-10 max-w-full items-center gap-1.5 rounded-md border border-warn bg-surface px-2 font-mono text-[11px] font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="max-w-[180px] truncate">${selection.name}</span>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="flex min-h-10 items-center gap-1.5 rounded-md px-2 font-medium text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("composer.refreshSkills")}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex min-h-10 items-center gap-1.5 rounded-md px-2 font-medium text-warn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings className="h-3.5 w-3.5" />
          {t("composer.openSkillsSettings")}
        </button>
      </div>
    </div>
  );
}
