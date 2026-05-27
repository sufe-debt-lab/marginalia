import { useEffect, useState } from "react";
import { AppShell } from "@/app/AppShell.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";

type Health = {
  status: "ok";
};

type UiStatus = PiServerStatus & { health?: Health };

function getBridge() {
  if (window.marginalia) return window.marginalia;
  const serverUrl = new URLSearchParams(window.location.search).get("serverUrl");
  if (import.meta.env.DEV && serverUrl) {
    return {
      getPiServerStatus: async () => ({ status: "ready" as const, url: serverUrl }),
      restartPiServer: async () => ({ status: "ready" as const, url: serverUrl })
    };
  }
  return null;
}

export function App() {
  const { t } = useTranslation();
  const [server, setServer] = useState<UiStatus>({ status: "starting" });

  async function loadHealth(status: PiServerStatus) {
    if (status.status !== "ready") {
      setServer(status);
      return;
    }
    try {
      const response = await fetch(`${status.url}/health`);
      if (!response.ok) throw new Error(`health check failed: ${response.status}`);
      const health = (await response.json()) as Health;
      setServer({ ...status, health });
    } catch (err) {
      setServer({ status: "failed", error: (err as Error).message, logs: [] });
    }
  }

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setServer({ status: "failed", error: "desktop bridge unavailable", logs: [] });
      return;
    }
    void bridge.getPiServerStatus().then(loadHealth);
  }, []);

  async function retry() {
    const bridge = getBridge();
    if (!bridge) return;
    setServer({ status: "starting" });
    await loadHealth(await bridge.restartPiServer());
  }

  if (server.status === "starting") {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        {t("status.startingServer")}
      </div>
    );
  }
  if (server.status === "failed") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive">{server.error}</p>
        <Button onClick={retry}>{t("common.retry")}</Button>
      </div>
    );
  }

  return <AppShell serverUrl={server.url} />;
}
