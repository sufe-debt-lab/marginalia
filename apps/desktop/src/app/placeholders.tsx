import { useTranslation } from "@/i18n/useTranslation.js";

export function DocumentPanelPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center bg-card text-sm text-muted-foreground">
      {t("placeholders.documentPanelComing")}
    </div>
  );
}
