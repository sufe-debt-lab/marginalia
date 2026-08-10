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

  async function loadHealth(status: PiServerStatus) {
    if (status.status !== "ready") {
      setServer(status);
      return;
    }
    try {
      const response = await desktopPiServerFetch(`${status.url}/health`);
      if (!response.ok) throw new Error(`health check failed: ${response.status}`);
      const health = (await response.json()) as Health;
      setServer({ ...status, health });
    } catch (err) {
      setServer({ status: "failed", error: (err as Error).message, logs: [] });
    }
  }

  useEffect(() => {
    if (!bridge) return;
    const desktopBridge = bridge;
    let canceled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function refreshStatus() {
      try {
        const status = await desktopBridge.getPiServerStatus();
        if (canceled) return;
        await loadHealth(status);
        if (!canceled && status.status === "starting") {
          pollTimer = setTimeout(refreshStatus, 250);
        }
      } catch (err) {
        if (!canceled) {
          setServer({ status: "failed", error: (err as Error).message, logs: [] });
        }
      }
    }

    void refreshStatus();
    return () => {
      canceled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [bridge]);

  async function retry() {
    if (!bridge) return;
    setServer({ status: "starting" });
    await loadHealth(await bridge.restartPiServer());
  }

  if (server.status === "starting") {
    return <LoadingSplash />;
  }
  if (server.status === "failed") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive">
          {server.error === "invalid_pi_server_status"
            ? t("common.invalidPiServerStatus")
            : server.error}
        </p>
        <Button onClick={retry}>{t("common.retry")}</Button>
      </div>
    );
  }

  return <AppShell serverUrl={server.url} />;
}
