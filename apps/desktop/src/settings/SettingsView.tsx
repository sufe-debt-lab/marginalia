import { useState, type ReactNode } from "react";
import { KeyRound, Settings as SettingsIcon, Sparkles, Wrench } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { GeneralPane } from "./GeneralPane.js";
import { ProvidersPane } from "./ProvidersPane.js";

type SettingsTab = "general" | "providers" | "mcp" | "skills";

export function SettingsView({ api }: { api: ApiClient }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("general");

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
      icon: <Sparkles className="h-3.5 w-3.5" />,
      disabled: true
    }
  ];

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-border-soft p-3">
        <div className="px-2.5 pb-2 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint">
          {t("settings.title")}
        </div>
        {nav.map((it) => (
          <button
            key={it.id}
            type="button"
            disabled={it.disabled}
            onClick={() => setTab(it.id)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-text-muted",
              "disabled:cursor-not-allowed disabled:opacity-40",
              tab === it.id && "bg-surface-3 text-foreground",
              !it.disabled && tab !== it.id && "hover:bg-accent"
            )}
            title={it.disabled ? t("settings.notImplemented") : undefined}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto px-9 py-7">
        {tab === "general" && <GeneralPane />}
        {tab === "providers" && <ProvidersPane api={api} />}
      </div>
    </div>
  );
}
