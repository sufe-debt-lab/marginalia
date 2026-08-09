import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { KeyRound, Settings as SettingsIcon, Sparkles, Wrench } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import type { SettingsEntryTab } from "@/store/app-store.js";
import { GeneralPane } from "./GeneralPane.js";
import { ProvidersPane } from "./ProvidersPane.js";
import { SkillsPane } from "./SkillsPane.js";

type SettingsTab = "general" | "providers" | "mcp" | "skills";

export function SettingsView({
  api,
  skillsWorkspace = null,
  initialTab = "general"
}: {
  api: ApiClient;
  skillsWorkspace?: { id: string; name: string } | null;
  initialTab?: SettingsEntryTab;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [animateTab, setAnimateTab] = useState(false);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement>>>({});

  useEffect(() => {
    tabRefs.current[initialTab]?.focus();
  }, [initialTab]);

  function selectTab(next: SettingsTab) {
    if (next !== tab) setAnimateTab(true);
    setTab(next);
  }

  const nav: { id: SettingsTab; label: string; icon: ReactNode; disabled?: boolean }[] = [
    {
      id: "general",
      label: t("settings.navGeneral"),
      icon: <SettingsIcon className="h-3.5 w-3.5" />
    },
    {
      id: "providers",
      label: t("settings.navProviders"),
      icon: <KeyRound className="h-3.5 w-3.5" />
    },
    {
      id: "mcp",
      label: t("settings.navMcp"),
      icon: <Wrench className="h-3.5 w-3.5" />,
      disabled: true
    },
    {
      id: "skills",
      label: t("settings.navSkills"),
      icon: <Sparkles className="h-3.5 w-3.5" />
    }
  ];

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: SettingsTab) {
    const enabledTabs = nav.filter((item) => !item.disabled).map((item) => item.id);
    const currentIndex = enabledTabs.indexOf(current);
    let next: SettingsTab | undefined;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = enabledTabs[(currentIndex + 1) % enabledTabs.length];
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = enabledTabs[(currentIndex - 1 + enabledTabs.length) % enabledTabs.length];
    } else if (event.key === "Home") {
      next = enabledTabs[0];
    } else if (event.key === "End") {
      next = enabledTabs.at(-1);
    }

    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex h-full min-h-0">
      <nav
        role="tablist"
        aria-orientation="vertical"
        aria-label={t("settings.title")}
        className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border-soft px-2.5 py-3.5"
      >
        <div
          role="presentation"
          className="px-2.5 pb-2 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint"
        >
          {t("settings.title")}
        </div>
        {nav.map((it) => (
          <button
            key={it.id}
            ref={(element) => {
              tabRefs.current[it.id] = element ?? undefined;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${it.id}`}
            aria-controls={it.disabled ? undefined : "settings-panel"}
            aria-selected={tab === it.id}
            tabIndex={tab === it.id ? 0 : -1}
            disabled={it.disabled}
            onClick={() => selectTab(it.id)}
            onKeyDown={(event) => handleTabKeyDown(event, it.id)}
            className={cn(
              "flex min-h-10 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-40",
              tab === it.id && "bg-select font-medium text-foreground",
              !it.disabled && tab !== it.id && "hover:bg-accent"
            )}
            title={it.disabled ? t("settings.notImplemented") : undefined}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
      <div
        key={tab}
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className={cn(
          "min-w-0 flex-1 overflow-auto px-8 pb-14 pt-[26px]",
          animateTab && "motion-tab-panel"
        )}
      >
        <div
          data-testid="settings-pane-width"
          className={cn("w-full", tab === "skills" ? "max-w-[920px]" : "max-w-[440px]")}
        >
          {tab === "general" && <GeneralPane />}
          {tab === "providers" && <ProvidersPane api={api} />}
          {tab === "skills" && <SkillsPane api={api} workspace={skillsWorkspace} />}
        </div>
      </div>
    </div>
  );
}
