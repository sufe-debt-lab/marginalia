import { Check, FolderPlus, KeyRound } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "workspace";
}

/** Welcome + two-step onboarding shown when no workspace exists yet. */
export function FirstRunView({ api }: { api: ApiClient }) {
  const { t } = useTranslation();
  const workspaces = useWorkspaces(api);
  const providers = useProviders(api);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setView = useAppStore((s) => s.setView);

  const hasWorkspace = workspaces.data.length > 0;
  const hasProvider = providers.data.length > 0;

  async function pickFolder() {
    const picked = await window.marginalia?.pickWorkspaceDirectory?.();
    if (!picked) return;
    try {
      const created = await workspaces.create({ name: basename(picked), rootDir: picked });
      setActiveWorkspace(created.id);
      toast.success(`${t("toast.workspaceCreated")}: ${created.name}`);
    } catch (err) {
      toast.error(`${t("toast.createWorkspaceFailed")}: ${(err as Error).message}`);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-10">
      <div className="relative h-24 w-24 overflow-hidden rounded-[22px] border border-border bg-surface shadow-md">
        <span className="absolute left-[22px] top-[22px] h-9 w-9 rounded-[9px] bg-brand opacity-85" />
        <span className="absolute bottom-[22px] right-[22px] h-9 w-9 rounded-[9px] bg-foreground opacity-90" />
      </div>

      <div className="max-w-[460px] text-center">
        <h1 className="h-display mb-2.5 text-[26px] font-normal tracking-tight">
          {t("firstRun.title")}
        </h1>
        <p className="text-sm leading-relaxed text-text-muted">{t("firstRun.subtitle")}</p>
      </div>

      <div className="flex w-[460px] flex-col gap-2">
        <SetupRow
          done={hasWorkspace}
          icon={<FolderPlus className="h-3.5 w-3.5" />}
          title={t("firstRun.step1Title")}
          desc={t("firstRun.step1Desc")}
          action={
            <Button size="sm" onClick={() => void pickFolder()}>
              {t("firstRun.step1Action")}
            </Button>
          }
        />
        <SetupRow
          done={hasProvider}
          icon={<KeyRound className="h-3.5 w-3.5" />}
          title={t("firstRun.step2Title")}
          desc={t("firstRun.step2Desc")}
          action={
            <Button variant="secondary" size="sm" onClick={() => setView("settings")}>
              {t("firstRun.step2Action")}
            </Button>
          }
        />
      </div>
    </div>
  );
}

function SetupRow({
  done,
  icon,
  title,
  desc,
  action
}: {
  done?: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  action: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-border bg-surface p-3.5">
      <span
        className={cn(
          "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px]",
          done ? "bg-ok-soft text-ok" : "bg-surface-3 text-text-muted"
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : icon}
      </span>
      <div className="flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12.5px] text-text-muted">{desc}</p>
      </div>
      {done ? (
        <span className="mono self-center text-[11.5px] text-ok">{t("firstRun.done")}</span>
      ) : (
        action
      )}
    </div>
  );
}
