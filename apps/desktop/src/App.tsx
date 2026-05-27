import { useEffect, useState } from "react";
import { WorkspaceShell } from "./workspaces/WorkspaceShell.js";

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
  const [server, setServer] = useState<UiStatus>({ status: "starting" });

  async function loadHealth(status: PiServerStatus) {
    if (status.status !== "ready") {
      setServer(status);
      return;
    }
    const response = await fetch(`${status.url}/health`);
    const health = (await response.json()) as Health;
    setServer({ ...status, health });
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

  if (server.status === "starting") return <main>starting</main>;
  if (server.status === "failed") {
    return (
      <main>
        <p>{server.error}</p>
        <button onClick={retry}>Retry</button>
      </main>
    );
  }

  return (
    <main>
      <p>{server.health?.status === "ok" ? "health ok" : "checking health"}</p>
      <WorkspaceShell serverUrl={server.url} />
    </main>
  );
}
