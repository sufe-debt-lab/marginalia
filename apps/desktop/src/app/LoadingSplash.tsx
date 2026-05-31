import { useTranslation } from "@/i18n/useTranslation.js";

/**
 * Branded loading view shown while pi-server boots. Mirrors the static splash
 * inlined in index.html (emerald shimmer sweep across the serif wordmark) so the
 * pre-paint splash → React handoff is seamless.
 */
export function LoadingSplash() {
  const { t } = useTranslation();
  return (
    <div className="splash" role="status" aria-label={t("status.startingServer")}>
      <div className="splash-mark">Marginalia</div>
      <div className="splash-dots" aria-hidden="true">
        <span className="splash-dot" />
        <span className="splash-dot" />
        <span className="splash-dot" />
      </div>
    </div>
  );
}
