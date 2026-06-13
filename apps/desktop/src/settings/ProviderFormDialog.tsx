import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { openExternal } from "@/lib/open-external.js";
import { ProviderAvatar } from "./ProviderAvatar.js";
import { PROVIDER_PRESETS, presetDescription, presetLabel } from "./provider-catalog.js";

export type ProviderFormValues = {
  name: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
};

const inputCls =
  "h-9 rounded-lg border-border bg-surface text-[13px] shadow-none transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-soft focus-visible:ring-offset-0";

function Field({
  id,
  label,
  action,
  hint,
  children
}: {
  id: string;
  label: string;
  action?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[10.5px] font-semibold uppercase tracking-wider text-text-muted"
        >
          {label}
        </label>
        {action}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-text-faint">{hint}</p>}
    </div>
  );
}

export function ProviderFormDialog({
  open,
  mode,
  locale,
  seedPresetKey,
  initial,
  apiKeyUrl,
  onClose,
  onSubmit
}: {
  open: boolean;
  mode: "add" | "edit";
  locale: "en" | "zh";
  /** add mode: jump straight to this preset's form when provided. */
  seedPresetKey?: string | null;
  /** edit mode: prefill these values (apiKey is never prefilled). */
  initial?: { name: string; baseUrl: string; defaultModel: string };
  /** edit mode: link to the provider's API-key page, resolved by the parent. */
  apiKeyUrl?: string;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => void;
}) {
  const { t } = useTranslation();
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  const preset = PROVIDER_PRESETS.find((p) => p.key === presetKey) ?? null;
  const resolvedApiKeyUrl = preset?.apiKeyUrl ?? apiKeyUrl;
  const showForm = mode === "edit" || presetKey !== null;
  const canSubmit = !!name.trim() && !!defaultModel.trim();
  const fid = (field: string) => `pf-${mode}-${field}`;

  function reset() {
    setPresetKey(null);
    setName("");
    setBaseUrl("");
    setApiKey("");
    setDefaultModel("");
  }

  function choosePreset(key: string) {
    const p = PROVIDER_PRESETS.find((x) => x.key === key) ?? {
      name: "",
      baseUrl: "",
      defaultModel: ""
    };
    setPresetKey(key);
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setDefaultModel(p.defaultModel);
  }

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setName(initial.name);
      setBaseUrl(initial.baseUrl);
      setApiKey("");
      setDefaultModel(initial.defaultModel);
    } else if (seedPresetKey) {
      choosePreset(seedPresetKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, seedPresetKey]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-[480px] gap-0 overflow-hidden border-border p-0 shadow-lg">
        {!showForm ? (
          <>
            <div className="border-b border-border-soft px-6 pb-[18px] pt-[22px]">
              <DialogTitle className="h-display text-[19px] font-medium tracking-tight">
                {t("settings.addProvider")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12.5px] text-text-muted">
                {t("settings.chooseProvider")}
              </DialogDescription>
            </div>
            <div className="grid grid-cols-2 gap-2 px-6 py-5">
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => choosePreset(p.key)}
                  className="group flex min-h-[64px] items-center gap-3 rounded-[10px] border border-border bg-transparent px-3 py-3 text-left transition-[background-color,border-color] motion-fast hover:border-text-subtle hover:bg-background"
                >
                  <ProviderAvatar name={p.name} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold">
                      {presetLabel(p, locale)}
                    </span>
                    <span className="mt-px block truncate text-xs text-text-muted">
                      {presetDescription(p, locale)}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => choosePreset("custom")}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border-strong px-3 py-[13px] text-[13.5px] text-text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("settings.custom")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3.5 border-b border-border-soft px-6 pb-[18px] pt-[22px]">
              <ProviderAvatar name={name} size={40} />
              <div className="min-w-0">
                <DialogTitle className="text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
                  {mode === "edit" ? t("settings.editProvider") : t("settings.addProvider")}
                </DialogTitle>
                <div className="truncate text-[17px] font-semibold leading-snug">
                  {name.trim() || t("settings.custom")}
                </div>
                <DialogDescription className="sr-only">
                  {t("settings.providersSubtitle")}
                </DialogDescription>
              </div>
            </div>

            <div className="space-y-3.5 px-6 py-5">
              <Field id={fid("name")} label={t("settings.fieldName")}>
                <Input
                  id={fid("name")}
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field id={fid("baseurl")} label={t("settings.fieldBaseUrl")}>
                <Input
                  id={fid("baseurl")}
                  className={cn(inputCls, "mono")}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              </Field>
              <Field
                id={fid("apikey")}
                label={t("settings.fieldApiKey")}
                hint={mode === "edit" ? t("settings.apiKeyKeepHint") : undefined}
                action={
                  resolvedApiKeyUrl && (
                    <button
                      type="button"
                      onClick={() => openExternal(resolvedApiKeyUrl)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-brand transition-colors hover:text-brand-strong"
                    >
                      {t("settings.getApiKey")}
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                  )
                }
              >
                <Input
                  id={fid("apikey")}
                  type="password"
                  className={inputCls}
                  placeholder={mode === "edit" ? "••••••••" : "sk-…"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>
              <Field id={fid("model")} label={t("settings.fieldDefaultModel")}>
                <Input
                  id={fid("model")}
                  className={cn(inputCls, "mono")}
                  value={defaultModel}
                  onChange={(e) => setDefaultModel(e.target.value)}
                />
              </Field>
            </div>

            <DialogFooter className="flex items-center gap-2 border-t border-border-soft bg-surface-2 px-6 py-3.5">
              <Button
                variant="ghost"
                size="sm"
                className="text-text-muted hover:text-foreground"
                onClick={() => {
                  if (mode === "edit") {
                    reset();
                    onClose();
                  } else {
                    setPresetKey(null);
                  }
                }}
              >
                {mode === "edit" ? t("settings.cancel") : t("settings.back")}
              </Button>
              <Button
                size="sm"
                disabled={!canSubmit}
                onClick={() => onSubmit({ name, apiKey, baseUrl, defaultModel })}
              >
                {t("settings.save")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
