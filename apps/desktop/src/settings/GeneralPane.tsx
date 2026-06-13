import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { useAppStore } from "@/store/app-store.js";
import { PaneHeader, SectionLabel, SettingCard, SettingRow, Toggle } from "./SettingsPrimitives.js";

export function GeneralPane() {
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
            <div className="flex overflow-hidden rounded-md border border-border bg-surface">
              {(["zh", "en"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLocale(v)}
                  className={cn(
                    "px-3 py-1 text-[12.5px]",
                    locale === v ? "bg-foreground text-background" : "text-text-muted"
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
            <Button variant="outline" size="sm" onClick={restart} disabled={restarting}>
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
                    <Button variant="outline" size="sm" disabled>
                      {t("settings.export")}
                    </Button>
                    <Button variant="outline" size="sm" disabled>
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
