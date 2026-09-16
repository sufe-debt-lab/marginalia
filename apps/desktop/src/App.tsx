import { useEffect, useState } from "react";
import { AppShell } from "@/app/AppShell.js";
import { LoadingSplash } from "@/app/LoadingSplash.js";
import { Button } from "@/components/ui/button.js";
import { desktopPiServerFetch } from "@/api/desktop-transport.js";
import { useTranslation } from "@/i18n/useTranslation.js";

type Health = {
  status: "ok";
};

type UiStatus = PiServerStatus & { health?: Health };

function getBridge() {
  const params = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const hadLegacyCredentials = params.has("capabilityToken") || fragment.has("capabilityToken");
  params.delete("capabilityToken");
  fragment.delete("capabilityToken");
  if (hadLegacyCredentials) {
    const remainingQuery = params.toString();
    const remainingFragment = fragment.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ""}${remainingFragment ? `#${remainingFragment}` : ""}`
    );
  }
  return window.marginalia ?? null;
}

export function App() {
  const { t } = useTranslation();
  const [bridge] = useState(() => getBridge());
  const [server, setServer] = useState<UiStatus>(() =>
    bridge
      ? { status: "starting" }
      : { status: "failed", error: "desktop bridge unavailable", logs: [] }
  );

  const [restartAttempt, setRestartAttempt] = useState(0);

  useEffect(() => {
    if (!bridge) return;
    const desktopBridge = bridge;
    let canceled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let healthyUrl: string | null = null;

    async function refreshStatus(restart = false) {
      try {
        const status = restart
          ? await desktopBridge.restartPiServer()
          : await desktopBridge.getPiServerStatus();
        if (canceled) return;
        if (status.status === "ready" && healthyUrl !== status.url) {
          const response = await desktopPiServerFetch(`${status.url}/health`);
          if (!response.ok) throw new Error(`health check failed: ${response.status}`);
          const health = (await response.json()) as Health;
          if (canceled) return;
          healthyUrl = status.url;
          setServer({ ...status, health });
        } else if (status.status !== "ready") {
          healthyUrl = null;
          setServer(status);
        }
        if (!canceled && status.status !== "failed") {
          pollTimer = setTimeout(
            () => void refreshStatus(),
            status.status === "starting" ? 250 : 1000
          );
        }
      } catch (err) {
        if (!canceled) {
          setServer({ status: "failed", error: (err as Error).message, logs: [] });
        }
      }
    }

    void refreshStatus(restartAttempt > 0);
    return () => {
      canceled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [bridge, restartAttempt]);

  function retry() {
    setServer({ status: "starting" });
    setRestartAttempt((attempt) => attempt + 1);
  }

  if (server.status === "starting") {
    return <LoadingSplash />;
  }
  if (server.status === "failed") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
        <p role="alert" className="text-destructive">
          {server.error === "pi-server exited"
            ? t("common.serverStopped")
            : server.error === "invalid_pi_server_status"
              ? t("common.invalidPiServerStatus")
              : t("common.serverUnavailable")}
        </p>
        <Button onClick={retry}>{t("common.retry")}</Button>
      </div>
    );
  }

  return <AppShell serverUrl={server.url} />;
}
