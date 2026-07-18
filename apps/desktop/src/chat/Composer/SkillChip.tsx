import { X } from "lucide-react";
import type { SkillCandidate, SkillSelection, SkillSource } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";

interface Props {
  skill: SkillSelection;
  candidate?: SkillCandidate;
  onRemove: (path: string) => void;
}

const SOURCE_KEYS = {
  workspace_marginalia: "composer.skillSourceWorkspaceMarginalia",
  workspace_pi: "composer.skillSourceWorkspacePi",
  ancestor_agents: "composer.skillSourceAncestorAgents",
  user_marginalia: "composer.skillSourceUserMarginalia",
  user_pi: "composer.skillSourceUserPi",
  user_agents: "composer.skillSourceUserAgents"
} as const satisfies Record<SkillSource, string>;

export function SkillChip({ skill, candidate, onRemove }: Props) {
  const { t } = useTranslation();
  const source = candidate ? t(SOURCE_KEYS[candidate.source]) : t("composer.skillSourceUnknown");
  const title = `${source}: ${candidate?.canonicalPath ?? skill.path}`;
  const hasWarning = candidate?.diagnostics.some((item) => item.level === "warning") === true;

  return (
    <div
      data-testid={`skill-chip-${skill.path}`}
      title={title}
      className="flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface-2 py-1 pl-2.5 pr-1.5 text-xs"
    >
      <span className="min-w-0 max-w-[220px] truncate font-mono font-medium text-text">
        ${skill.name}
      </span>
      {hasWarning && (
        <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">
          {t("composer.skillWarning")}
        </span>
      )}
      {candidate?.explicitOnly && (
        <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand-strong">
          {t("composer.skillExplicitOnly")}
        </span>
      )}
      <button
        type="button"
        aria-label={`${t("composer.removeSkill")} ${skill.name}`}
        onClick={() => onRemove(skill.path)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-[background-color,color,transform] hover:bg-surface-3 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
      >
        <X className="h-3 w-3" strokeWidth={2.2} />
      </button>
    </div>
  );
}
