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
    <div className="flex h-full flex-col items-center justify-center px-8 py-[60px]">
      <div
        data-testid="first-run-logo"
        className="relative mb-6 h-[70px] w-[70px] overflow-hidden rounded-[18px] border border-border bg-surface shadow-md"
      >
        <span className="absolute left-[15px] top-[15px] h-[26px] w-[26px] rounded-[5px] bg-brand opacity-90" />
        <span className="absolute bottom-[15px] right-[15px] h-[26px] w-[26px] rounded-[5px] bg-foreground opacity-95" />
      </div>

      <div className="max-w-[460px] text-center">
        <h1 className="h-display mb-2 text-[28px] font-medium tracking-[-0.02em]">
          {t("firstRun.title")}
        </h1>
        <p className="mx-auto max-w-[312px] text-[13.5px] leading-[1.65] text-text-muted">
          {t("firstRun.subtitle")}
        </p>
      </div>

      <div className="mt-9 flex w-full max-w-[460px] flex-col gap-[9px]">
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
            <Button variant="outline" size="sm" onClick={() => setView("settings")}>
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
    <div className="flex items-center gap-3.5 rounded-card border border-border bg-surface px-[18px] py-[15px] shadow-sm">
      <span
        className={cn(
          "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[7px] border border-border-soft",
          done ? "bg-ok-soft text-ok" : "bg-surface-3 text-text-muted"
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : icon}
      </span>
      <div className="flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">{desc}</p>
      </div>
      {done ? (
        <span className="mono self-center text-[11.5px] text-ok">{t("firstRun.done")}</span>
      ) : (
        action
      )}
    </div>
  );
}
