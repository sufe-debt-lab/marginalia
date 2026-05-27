import { useTranslation } from "@/i18n/useTranslation.js";

export function MainPlaceholder({ view }: { view: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground shadow-sm">
        <p className="font-medium text-foreground">{t("placeholders.comingNextPr")}</p>
        <p className="mt-1">
          {t("placeholders.currentView")}:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{view}</code>
        </p>
      </div>
    </div>
  );
}

export function DocumentPanelPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-card text-sm text-muted-foreground">
      {t("placeholders.documentPanelComing")}
    </div>
  );
}
