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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";

type SettingsTab = "general" | "providers" | "mcp" | "skills";

export function SettingsView({ api }: { api: ApiClient }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("general");

  const nav: { id: SettingsTab; label: string; icon: ReactNode; disabled?: boolean }[] = [
    { id: "general", label: t("settings.navGeneral"), icon: <SettingsIcon className="h-3.5 w-3.5" /> },
    { id: "providers", label: t("settings.navProviders"), icon: <KeyRound className="h-3.5 w-3.5" /> },
    { id: "mcp", label: t("settings.navMcp"), icon: <Wrench className="h-3.5 w-3.5" />, disabled: true },
    { id: "skills", label: t("settings.navSkills"), icon: <Sparkles className="h-3.5 w-3.5" />, disabled: true }
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

function PaneHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
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
    <div className="mb-5 overflow-hidden rounded-[10px] border border-border bg-surface">{children}</div>
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
    <div className={cn("flex items-center gap-4 px-4 py-3.5", !last && "border-b border-border-soft")}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-text-muted">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function GeneralPane() {
  const { t } = useTranslation();
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
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
  const { t } = useTranslation();
  const loaded = useProviders(api);
  const [extra, setExtra] = useState<Provider[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const providers = [...loaded.data, ...extra];

  async function handleTest(id: string) {
    try {
      const res = await api.testProvider(id);
      if (res.ok) toast.success(res.message || "OK");
      else toast.error(res.message);
    } catch (err) {
      toast.error((err as Error).message);
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
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("settings.addProvider")}
          </Button>
        }
      />
      <SettingCard>
        {providers.length === 0 && (
          <div className="px-4 py-6 text-sm text-text-muted">{t("settings.noProviders")}</div>
        )}
        {providers.map((p, i) => (
          <div
            key={p.id}
            className={cn(
              "flex items-center gap-3.5 px-4 py-3.5",
              i < providers.length - 1 && "border-b border-border-soft"
            )}
          >
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-surface-3 font-mono text-xs font-semibold text-text-muted">
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="dot ok" />
                <span className="text-[11.5px] text-text-muted">{t("settings.connected")}</span>
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-text-faint">
                <span className="mono">{p.defaultModel}</span>
              </div>
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
        ))}
      </SettingCard>

      <AddProviderDialog open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAdd} />
    </>
  );
}

function AddProviderDialog({
  open,
  onClose,
  onSubmit
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; apiKey: string; baseUrl?: string; defaultModel: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  function reset() {
    setName("");
    setBaseUrl("");
    setApiKey("");
    setDefaultModel("");
  }

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
          <DialogDescription>{t("settings.providersSubtitle")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input aria-label={t("settings.fieldName")} placeholder={t("settings.fieldName")} value={name} onChange={(e) => setName(e.target.value)} />
          <Input aria-label={t("settings.fieldBaseUrl")} placeholder={t("settings.fieldBaseUrl")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <Input aria-label={t("settings.fieldApiKey")} type="password" placeholder={t("settings.fieldApiKey")} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <Input aria-label={t("settings.fieldDefaultModel")} placeholder={t("settings.fieldDefaultModel")} value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
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
      </DialogContent>
    </Dialog>
  );
}
