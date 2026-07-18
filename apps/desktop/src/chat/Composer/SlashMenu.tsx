import type { SkillPickerItem } from "@/hooks/useSkillCatalog.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { COMPOSER_MENU_CLS, useMenuNav } from "./useMenuNav.js";

const COMMANDS = [
  { name: "clear", helpKey: "composer.slashClear" },
  { name: "help", helpKey: "composer.slashHelp" },
  { name: "model", helpKey: "composer.slashModel" }
] as const;

export type SlashRow =
  | { kind: "command"; key: string; name: string; helpKey: (typeof COMMANDS)[number]["helpKey"] }
  | { kind: "skill"; key: string; skill: SkillPickerItem };

interface Props {
  query: string;
  skills: readonly SkillPickerItem[];
  skillsLoading: boolean;
  skillsError: Error | null;
  onSelect: (row: SlashRow) => void;
  onRetrySkills: () => void;
  onClose: () => void;
}

function skillMatches(item: SkillPickerItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return (
    item.name.toLocaleLowerCase().includes(normalized) ||
    item.description?.toLocaleLowerCase().includes(normalized) === true
  );
}

export function SlashMenu({
  query,
  skills,
  skillsLoading,
  skillsError,
  onSelect,
  onRetrySkills,
  onClose
}: Props) {
  const { t } = useTranslation();
  const normalizedQuery = query.toLocaleLowerCase();
  const commandRows: SlashRow[] = COMMANDS.filter((command) =>
    command.name.startsWith(normalizedQuery)
  ).map((command) => ({
    kind: "command",
    key: `command:${command.name}`,
    name: command.name,
    helpKey: command.helpKey
  }));
  const skillRows: SlashRow[] =
    skillsLoading || skillsError
      ? []
      : skills
          .filter((skill) => skillMatches(skill, query))
          .map((skill) => ({
            kind: "skill",
            key: skill.canonicalPath,
            skill
          }));
  const selectableRows = [...commandRows, ...skillRows];
  const resetKey = `${query}\0${selectableRows.map((row) => row.key).join("\0")}`;
  const { activeIndex, setActiveIndex } = useMenuNav(selectableRows, onSelect, onClose, resetKey);

  return (
    <div
      role="listbox"
      aria-label={t("composer.slashMenu")}
      className={cn(COMPOSER_MENU_CLS, "max-h-[190px] w-80 overflow-auto")}
    >
      <SectionLabel>{t("composer.commandsSection")}</SectionLabel>
      {commandRows.length === 0 ? (
        <MenuStatus>{t("composer.noCommands")}</MenuStatus>
      ) : (
        commandRows.map((row, index) =>
          row.kind === "command" ? (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={rowClass(index === activeIndex)}
              onClick={() => onSelect(row)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="font-mono font-medium">/{row.name}</span>
              <span className="truncate text-text-muted">{t(row.helpKey)}</span>
            </button>
          ) : null
        )
      )}

      <div className="my-1 border-t border-border-soft" />
      <SectionLabel>{t("composer.skillsSection")}</SectionLabel>
      {skillsLoading ? (
        <MenuStatus>{t("common.loading")}</MenuStatus>
      ) : skillsError ? (
        <div className="flex min-h-10 items-center justify-between gap-3 px-2.5 py-2 text-xs text-text-muted">
          <span>{t("composer.skillsRefreshFailed")}</span>
          <button
            type="button"
            onClick={onRetrySkills}
            className="shrink-0 rounded-md px-2 py-1 font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : skillRows.length === 0 ? (
        <MenuStatus>{t("composer.noSkills")}</MenuStatus>
      ) : (
        skillRows.map((row, skillIndex) => {
          if (row.kind !== "skill") return null;
          const index = commandRows.length + skillIndex;
          return (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={rowClass(index === activeIndex)}
              onClick={() => onSelect(row)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono font-medium">${row.skill.name}</span>
                {row.skill.description && (
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                    {row.skill.description}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[10px] text-text-subtle">
                {t("composer.skillType")}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-subtle">
      {children}
    </div>
  );
}

function MenuStatus({ children }: { children: string }) {
  return (
    <div className="flex min-h-10 items-center px-2.5 py-2 text-xs text-text-muted">{children}</div>
  );
}

function rowClass(active: boolean): string {
  return cn(
    "flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active && "bg-accent text-accent-foreground"
  );
}
