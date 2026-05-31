import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, Plus, RotateCw, Settings as SettingsIcon, Sparkles, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient, Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";
import {
  PROVIDER_PRESETS,
  brandColorFor,
  modelsForProvider,
  unconfiguredPresets
} from "./provider-catalog.js";

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

function PaneHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end gap-4 border-b border-border-soft pb-4">
      <div className="flex-1">
        <h1 className="h-display text-[22px] font-medium tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2.5 mt-6 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
      {children}
    </h2>
  );
}

function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 overflow-hidden rounded-[10px] border border-border bg-surface">
      {children}
    </div>
  );
}

function SettingRow({
  title,
  desc,
  control,
  last
}: {
  title: string;
  desc: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center gap-4 px-4 py-3.5", !last && "border-b border-border-soft")}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-text-muted">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
        on ? "bg-foreground" : "bg-border-strong"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all",
          on ? "left-4" : "left-0.5"
        )}
      />
    </button>
  );
}

function GeneralPane() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const resumeLastSession = useAppStore((s) => s.resumeLastSession);
  const setResumeLastSession = useAppStore((s) => s.setResumeLastSession);
  const [status, setStatus] = useState<PiServerStatus | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.marginalia?.getPiServerStatus?.().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function restart() {
    if (!window.marginalia?.restartPiServer) return;
    setRestarting(true);
    try {
      setStatus(await window.marginalia.restartPiServer());
    } finally {
      setRestarting(false);
    }
  }

  const dotClass = status?.status === "ready" ? "ok" : status?.status === "failed" ? "err" : "idle";
  const statusLabel =
    status?.status === "ready"
      ? t("settings.healthy")
      : status?.status === "failed"
        ? t("settings.failed")
        : t("settings.starting");

  return (
    <>
      <PaneHeader title={t("settings.navGeneral")} subtitle={t("settings.generalSubtitle")} />
      <SettingCard>
        <SettingRow
          title={t("common.language")}
          desc={t("settings.languageDesc")}
          control={
            <div className="flex gap-1 rounded-md bg-surface-3 p-0.5">
              {(["zh", "en"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLocale(v)}
                  className={cn(
                    "rounded px-2.5 py-1 text-xs font-medium",
                    locale === v ? "bg-surface text-foreground shadow-sm" : "text-text-muted"
                  )}
                >
                  {v === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          title={t("settings.resumeLast")}
          desc={t("settings.resumeLastDesc")}
          control={
            <Toggle
              on={resumeLastSession}
              onChange={setResumeLastSession}
              label={t("settings.resumeLast")}
            />
          }
        />
        <SettingRow
          title={t("settings.piServer")}
          desc={
            <span className="inline-flex items-center gap-2">
              <span className={cn("dot", dotClass)} />
              {status?.status === "ready" && (
                <span className="mono text-[11.5px]">{new URL(status.url).host}</span>
              )}
              <span className="text-text-faint">·</span>
              <span>{statusLabel}</span>
            </span>
          }
          control={
            <Button variant="secondary" size="sm" onClick={restart} disabled={restarting}>
              <RotateCw className={cn("mr-1 h-3 w-3", restarting && "animate-spin")} />
              {t("settings.restart")}
            </Button>
          }
          last
        />
      </SettingCard>

      <SectionLabel>{t("settings.dataSection")}</SectionLabel>
      <SettingCard>
        <SettingRow
          title={t("settings.localData")}
          desc={<span className="mono text-[11.5px]">~/.marginalia/db.sqlite</span>}
          control={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex gap-1.5">
                    <Button variant="secondary" size="sm" disabled>
                      {t("settings.export")}
                    </Button>
                    <Button variant="secondary" size="sm" disabled>
                      {t("settings.import")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("settings.notImplemented")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          last
        />
      </SettingCard>
    </>
  );
}

function ProvidersPane({ api }: { api: ApiClient }) {
  const { t, locale } = useTranslation();
  const loaded = useProviders(api);
  const [extra, setExtra] = useState<Provider[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [seedPreset, setSeedPreset] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const reasoning = useAppStore((s) => s.reasoning);
  const setReasoning = useAppStore((s) => s.setReasoning);
  const composerModel = useAppStore((s) => s.composerModel);
  const providers = [...loaded.data, ...extra];
  const others = unconfiguredPresets(providers);
  const globalDefault = providers[0]?.defaultModel ?? t("settings.none");
  const workspaceModel = composerModel || providers[0]?.defaultModel || t("settings.none");

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

  async function handleAdd(input: {
    name: string;
    apiKey: string;
    baseUrl?: string;
    defaultModel: string;
  }) {
    try {
      const created = await api.createProvider(input);
      setExtra((prev) => [...prev, created]);
      toast.success(`${t("settings.providerAdded")}: ${created.name}`);
      setAddOpen(false);
    } catch (err) {
      toast.error(`${t("settings.providerAddFailed")}: ${(err as Error).message}`);
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
              variant="secondary"
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

      {/* Defaults summary bar */}
      <div className="mb-5 flex items-center gap-5 rounded-[10px] border border-border bg-surface px-4 py-3.5 text-[13px]">
        <div className="flex-1">
          <div className="mb-1 text-[11.5px] text-text-muted">
            {t("settings.globalDefaultModel")}
          </div>
          <span className="mono font-medium">{globalDefault}</span>
        </div>
        <div className="h-7 w-px bg-border" />
        <div className="flex-1">
          <div className="mb-1 text-[11.5px] text-text-muted">{t("settings.thisWorkspace")}</div>
          <span className="mono font-medium">{workspaceModel}</span>
        </div>
        <div className="h-7 w-px bg-border" />
        <div className="flex-1">
          <div className="mb-1 text-[11.5px] text-text-muted">{t("settings.reasoningBudget")}</div>
          <div className="flex w-fit gap-0.5 rounded-md bg-surface-3 p-0.5">
            {(["low", "medium", "high"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setReasoning(b)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11.5px]",
                  reasoning === b ? "bg-surface text-foreground shadow-sm" : "text-text-muted"
                )}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SectionLabel>{t("settings.connected")}</SectionLabel>
      <SettingCard>
        {providers.length === 0 && (
          <div className="px-4 py-6 text-sm text-text-muted">{t("settings.noProviders")}</div>
        )}
        {providers.map((p, i) => (
          <div key={p.id} className={cn(i < providers.length - 1 && "border-b border-border-soft")}>
            <div className="flex items-center gap-3.5 px-4 py-3.5">
              <ProviderAvatar name={p.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="dot ok" />
                  <span className="text-[11.5px] text-text-muted">{t("settings.connected")}</span>
                </div>
                {p.baseUrl && (
                  <div className="mt-0.5 truncate text-[11.5px] text-text-faint">
                    <span className="mono">{p.baseUrl}</span>
                  </div>
                )}
              </div>
              <Button variant="secondary" size="sm" onClick={() => void handleTest(p.id)}>
                {t("settings.test")}
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="secondary" size="sm" disabled>
                        {t("settings.edit")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("settings.notImplemented")}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <div className="flex flex-col gap-1 px-4 pb-3.5">
              {modelsForProvider(p).map((m, mi) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2.5 rounded-md bg-surface-2 px-2.5 py-1.5"
                >
                  {(m.tag === "default" || mi === 0) && (
                    <span className="rounded bg-brand-soft px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-brand">
                      {t("settings.defaultBadge")}
                    </span>
                  )}
                  <span className="mono text-xs font-medium">{m.label}</span>
                  {m.tag && m.tag !== "default" && (
                    <span className="text-[11.5px] text-text-faint">{m.tag}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </SettingCard>

      {others.length > 0 && (
        <>
          <SectionLabel>{t("settings.others")}</SectionLabel>
          <SettingCard>
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
                  <div className="text-sm font-medium">
                    {locale === "zh" ? preset.labelZh : preset.label}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-text-muted">
                    <span className="dot idle" />
                    <span>{t("settings.notConfigured")}</span>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => openAddWith(preset.key)}>
                  <Plus className="mr-1 h-3 w-3" />
                  {t("settings.add")}
                </Button>
              </div>
            ))}
          </SettingCard>
        </>
      )}

      <ProviderPresetDialog
        open={addOpen}
        locale={locale}
        seedPresetKey={seedPreset}
        onClose={() => {
          setAddOpen(false);
          setSeedPreset(null);
        }}
        onSubmit={handleAdd}
      />
    </>
  );
}

function ProviderAvatar({ name }: { name: string }) {
  const color = brandColorFor(name);
  return (
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold"
      style={
        color
          ? { background: color, color: "#fff" }
          : { background: "var(--surface-3)", color: "var(--text-muted)" }
      }
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ProviderPresetDialog({
  open,
  locale,
  seedPresetKey,
  onClose,
  onSubmit
}: {
  open: boolean;
  locale: "en" | "zh";
  seedPresetKey?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    apiKey: string;
    baseUrl?: string;
    defaultModel: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const [presetKey, setPresetKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  const preset = PROVIDER_PRESETS.find((p) => p.key === presetKey) ?? null;

  function reset() {
    setPresetKey(null);
    setName("");
    setBaseUrl("");
    setApiKey("");
    setDefaultModel("");
  }

  function choosePreset(key: string) {
    const p = PROVIDER_PRESETS.find((x) => x.key === key);
    if (!p) {
      // custom
      setPresetKey("custom");
      setName("");
      setBaseUrl("");
      setDefaultModel("");
      return;
    }
    setPresetKey(key);
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setDefaultModel(p.defaultModel);
  }

  // When opened from an "Others" row, jump straight to that preset's form.
  useEffect(() => {
    if (open && seedPresetKey) choosePreset(seedPresetKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seedPresetKey]);

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.addProvider")}</DialogTitle>
          <DialogDescription>
            {presetKey ? t("settings.providersSubtitle") : t("settings.chooseProvider")}
          </DialogDescription>
        </DialogHeader>

        {!presetKey ? (
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => choosePreset(p.key)}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 text-left hover:bg-accent"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-3 font-mono text-xs font-semibold">
                  {p.label.slice(0, 1)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">
                    {locale === "zh" ? p.labelZh : p.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-text-muted">
                    {locale === "zh" ? p.descriptionZh : p.description}
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => choosePreset("custom")}
              className="col-span-2 rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-text-muted hover:bg-accent"
            >
              {t("settings.custom")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              aria-label={t("settings.fieldName")}
              placeholder={t("settings.fieldName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              aria-label={t("settings.fieldBaseUrl")}
              placeholder={t("settings.fieldBaseUrl")}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <Input
              aria-label={t("settings.fieldApiKey")}
              type="password"
              placeholder={t("settings.fieldApiKey")}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <Input
              aria-label={t("settings.fieldDefaultModel")}
              placeholder={t("settings.fieldDefaultModel")}
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
            />
            {preset?.apiKeyUrl && (
              <a
                href={preset.apiKeyUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-[11.5px] text-brand hover:underline"
              >
                {preset.apiKeyUrl}
              </a>
            )}
          </div>
        )}

        {presetKey && (
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPresetKey(null)}>
              {t("settings.cancel")}
            </Button>
            <Button
              disabled={!name.trim() || !apiKey.trim() || !defaultModel.trim()}
              onClick={() =>
                onSubmit({ name, apiKey, baseUrl: baseUrl || undefined, defaultModel })
              }
            >
              {t("settings.save")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
