import { useState } from "react";
import { Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient, Provider } from "@/api/client.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog.js";
import { Button } from "@/components/ui/button.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { ProviderAvatar } from "./ProviderAvatar.js";
import { ProviderFormDialog, type ProviderFormValues } from "./ProviderFormDialog.js";
import { ProviderRow } from "./ProviderRow.js";
import { PaneHeader, SectionLabel, SettingCard } from "./SettingsPrimitives.js";
import { findPreset, presetLabel, unconfiguredPresets } from "./provider-catalog.js";

export function ProvidersPane({ api }: { api: ApiClient }) {
  const { t, locale } = useTranslation();
  const loaded = useProviders(api);
  const [addOpen, setAddOpen] = useState(false);
  const [seedPreset, setSeedPreset] = useState<string | null>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const providers = loaded.data;
  const others = unconfiguredPresets(providers);

  function openAddWith(presetKey: string | null) {
    setSeedPreset(presetKey);
    setAddOpen(true);
  }

  async function handleTest(id: string) {
    try {
      const res = await api.testProvider(id);
      if (res.ok) toast.success(res.message || "OK");
      else toast.error(res.message);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function runDiagnostics() {
    if (providers.length === 0) return;
    setDiagnosing(true);
    try {
      const results = await Promise.all(
        providers.map((p) =>
          api.testProvider(p.id).catch((e) => ({ ok: false, message: (e as Error).message }))
        )
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) toast.success(t("settings.diagnosticsOk"));
      else
        toast.error(
          failed
            .map((f) => f.message)
            .filter(Boolean)
            .join("; ") || "failed"
        );
    } finally {
      setDiagnosing(false);
    }
  }

  async function handleAdd(values: ProviderFormValues) {
    try {
      const created = await api.createProvider({
        name: values.name,
        apiKey: values.apiKey,
        baseUrl: values.baseUrl || undefined,
        defaultModel: values.defaultModel
      });
      loaded.refresh();
      toast.success(`${t("settings.providerAdded")}: ${created.name}`);
      setAddOpen(false);
      setSeedPreset(null);
    } catch (err) {
      toast.error(`${t("settings.providerAddFailed")}: ${(err as Error).message}`);
    }
  }

  async function handleEdit(values: ProviderFormValues) {
    if (!editing) return;
    try {
      await api.updateProvider(editing.id, {
        name: values.name,
        baseUrl: values.baseUrl.trim() ? values.baseUrl.trim() : null,
        defaultModel: values.defaultModel,
        ...(values.apiKey ? { apiKey: values.apiKey } : {})
      });
      loaded.refresh();
      toast.success(t("settings.providerUpdated"));
      setEditing(null);
    } catch (err) {
      toast.error(`${t("settings.providerUpdateFailed")}: ${(err as Error).message}`);
    }
  }

  async function handleDelete(provider: Provider) {
    try {
      await api.deleteProvider(provider.id);
      loaded.refresh();
      toast.success(t("settings.providerDeleted"));
    } catch (err) {
      toast.error(`${t("settings.providerDeleteFailed")}: ${(err as Error).message}`);
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleEnabled(provider: Provider, next: boolean) {
    try {
      await api.updateProvider(provider.id, { enabled: next });
      loaded.refresh();
    } catch (err) {
      toast.error(`${t("settings.providerUpdateFailed")}: ${(err as Error).message}`);
    }
  }

  return (
    <>
      <PaneHeader
        title={t("settings.providersTitle")}
        subtitle={t("settings.providersSubtitle")}
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runDiagnostics()}
              disabled={diagnosing}
            >
              <RotateCw className={cn("mr-1 h-3 w-3", diagnosing && "animate-spin")} />
              {t("settings.runDiagnostics")}
            </Button>
            <Button size="sm" onClick={() => openAddWith(null)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t("settings.addProvider")}
            </Button>
          </div>
        }
      />

      <SectionLabel>{t("settings.connected")}</SectionLabel>
      {providers.length === 0 ? (
        <SettingCard>
          <div className="rounded-[10px] border border-dashed border-border bg-background px-5 py-5 text-center text-[13px] text-text-subtle">
            {t("settings.noProviders")}
          </div>
        </SettingCard>
      ) : (
        <SettingCard card className="shadow-sm">
          {providers.map((p, i) => (
            <ProviderRow
              key={p.id}
              provider={p}
              divider={i < providers.length - 1}
              onTest={() => void handleTest(p.id)}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
              onToggleEnabled={(next) => void handleToggleEnabled(p, next)}
            />
          ))}
        </SettingCard>
      )}

      {others.length > 0 && (
        <>
          <SectionLabel>{t("settings.others")}</SectionLabel>
          <SettingCard card className="mb-0">
            {others.map((preset, i) => (
              <div
                key={preset.key}
                className={cn(
                  "flex items-center gap-3.5 px-4 py-3.5",
                  i < others.length - 1 && "border-b border-border-soft"
                )}
              >
                <ProviderAvatar name={preset.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{presetLabel(preset, locale)}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-subtle">
                    <span className="dot idle" />
                    <span>{t("settings.notConfigured")}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openAddWith(preset.key)}>
                  <Plus className="mr-1 h-3 w-3" />
                  {t("settings.add")}
                </Button>
              </div>
            ))}
          </SettingCard>
        </>
      )}

      <ProviderFormDialog
        open={addOpen}
        mode="add"
        locale={locale}
        seedPresetKey={seedPreset}
        onClose={() => {
          setAddOpen(false);
          setSeedPreset(null);
        }}
        onSubmit={handleAdd}
      />

      <ProviderFormDialog
        open={!!editing}
        mode="edit"
        locale={locale}
        initial={
          editing
            ? {
                name: editing.name,
                baseUrl: editing.baseUrl ?? "",
                defaultModel: editing.defaultModel
              }
            : undefined
        }
        apiKeyUrl={editing ? findPreset(editing)?.apiKeyUrl : undefined}
        onClose={() => setEditing(null)}
        onSubmit={handleEdit}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="max-w-[420px] gap-3 border-border shadow-lg">
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              {deleting && <ProviderAvatar name={deleting.name} size={40} />}
              <AlertDialogTitle className="h-display text-[17px] font-medium tracking-tight">
                {t("settings.deleteConfirmTitle")}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-[12.5px] leading-relaxed text-text-muted">
              {t("settings.deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-9 text-[13px]">
              {t("settings.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 bg-danger text-[13px] text-white hover:bg-danger hover:opacity-90"
              onClick={() => deleting && void handleDelete(deleting)}
            >
              {t("settings.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
