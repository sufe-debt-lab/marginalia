import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import type { Provider } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { ProviderAvatar } from "./ProviderAvatar.js";
import { modelsForProvider } from "./provider-catalog.js";
import { Toggle } from "./SettingsPrimitives.js";

export function ProviderRow({
  provider,
  divider,
  onTest,
  onEdit,
  onDelete,
  onToggleEnabled
}: {
  provider: Provider;
  divider?: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const enabled = provider.enabled !== false;
  const models = modelsForProvider(provider);

  return (
    <div className={cn("overflow-hidden bg-surface", divider && "border-b border-border-soft")}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={cn("flex min-w-0 flex-1 items-center gap-3.5", !enabled && "opacity-55")}>
          <ProviderAvatar name={provider.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{provider.name}</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-xs",
                  enabled ? "text-brand" : "text-text-subtle"
                )}
              >
                <span className={cn("dot", enabled ? "brand" : "idle")} />
                {enabled ? t("settings.connected") : t("settings.notConfigured")}
              </span>
              {provider.baseUrl && (
                <span className="mono truncate text-[11px] text-text-subtle">
                  {provider.baseUrl}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <Toggle
            on={enabled}
            onChange={onToggleEnabled}
            label={`${t("settings.enabled")}: ${provider.name}`}
          />
          <span className="mx-1.5 h-4 w-px bg-border-soft" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[12px] text-text-muted hover:text-foreground"
            onClick={onTest}
          >
            {t("settings.test")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[12px] text-text-muted hover:text-foreground"
            onClick={onEdit}
          >
            {t("settings.edit")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("settings.delete")}
            className="h-7 w-7 text-text-faint hover:bg-danger-soft hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className={cn("flex flex-col border-t border-border-soft", !enabled && "opacity-55")}>
        {models.map((m, mi) => (
          <div
            key={m.id}
            className={cn(
              "flex items-center gap-2.5 px-4 py-2.5",
              mi < models.length - 1 && "border-b border-border-soft"
            )}
          >
            <span className="mono text-xs font-medium">{m.label}</span>
            {(m.tag === "default" || mi === 0) && (
              <span className="rounded bg-brand-soft px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-brand">
                {t("settings.defaultBadge")}
              </span>
            )}
            {m.tag && m.tag !== "default" && (
              <span className="text-[11.5px] text-text-faint">{m.tag}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
