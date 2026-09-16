import { contextBridge, ipcRenderer } from "electron";

type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string }
  | { status: "failed"; error: string; logs: string[] };

type PiServerRequest = {
  path: string;
  method: string;
  headers: [string, string][];
  body?: string;
};

type PiServerResponseEvent =
  | { type: "start"; status: number; statusText: string; headers: [string, string][] }
  | { type: "data"; chunk: Uint8Array }
  | { type: "end" }
  | { type: "error"; code: string };

function sanitizeStatus(value: unknown): PiServerStatus {
  if (!value || typeof value !== "object") {
    return { status: "failed", error: "invalid_pi_server_status", logs: [] };
  }
  const status = value as Record<string, unknown>;
  if (status.status === "starting") return { status: "starting" };
  if (status.status === "ready" && typeof status.url === "string") {
    return { status: "ready", url: status.url };
  }
  if (status.status === "failed" && typeof status.error === "string") {
    return {
      status: "failed",
      error: status.error,
      logs: Array.isArray(status.logs)
        ? status.logs.filter((item): item is string => typeof item === "string")
        : []
    };
  }
  return { status: "failed", error: "invalid_pi_server_status", logs: [] };
}

let requestSequence = 0;

function sanitizeResponseEvent(value: Record<string, unknown>): PiServerResponseEvent | null {
  if (
    value.type === "start" &&
    typeof value.status === "number" &&
    typeof value.statusText === "string" &&
    Array.isArray(value.headers) &&
    value.headers.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string"
    )
  ) {
    return {
      type: "start",
      status: value.status,
      statusText: value.statusText,
      headers: value.headers as [string, string][]
    };
  }
  if (value.type === "data" && ArrayBuffer.isView(value.chunk)) {
    return { type: "data", chunk: Uint8Array.from(value.chunk as Uint8Array) };
  }
  if (value.type === "end") return { type: "end" };
  if (value.type === "error" && typeof value.code === "string") {
    return { type: "error", code: value.code };
  }
  return null;
}

function requestPiServer(
  input: PiServerRequest,
  callback: (event: PiServerResponseEvent) => void
) {
  requestSequence += 1;
  const id = `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
  const listener = (_event: unknown, value: unknown) => {
    if (!value || typeof value !== "object") return;
    const response = value as Record<string, unknown>;
    if (response.id !== id) return;
    const event = sanitizeResponseEvent(response);
    if (!event) return;
    callback(event);
    if (event.type === "end" || event.type === "error") {
      ipcRenderer.removeListener("pi-server:response", listener);
    }
  };
  ipcRenderer.on("pi-server:response", listener);
  ipcRenderer.send("pi-server:request", { id, ...input });
  return () => {
    ipcRenderer.removeListener("pi-server:response", listener);
    ipcRenderer.send("pi-server:cancel", id);
  };
}

async function readStatus(channel: "pi-server:status" | "pi-server:restart") {
  return sanitizeStatus(await ipcRenderer.invoke(channel));
}

async function runPackagedSmoke() {
  const value = (await ipcRenderer.invoke("pi-server:packaged-smoke")) as Record<string, unknown>;
  if (
    value?.status === "ready" &&
    typeof value.healthStatus === "number" &&
    typeof value.unauthenticatedStatus === "number"
  ) {
    return {
      status: "ready" as const,
      healthStatus: value.healthStatus,
      unauthenticatedStatus: value.unauthenticatedStatus
    };
  }
  return {
    status: value?.status === "starting" ? ("starting" as const) : ("unavailable" as const)
  };
}

contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: (): Promise<PiServerStatus> => readStatus("pi-server:status"),
  restartPiServer: (): Promise<PiServerStatus> => readStatus("pi-server:restart"),
  requestPiServer,
  runPackagedSmoke,
  pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
  openExternal: (url: string) => ipcRenderer.invoke("marginalia:open-external", url),
  saveTextFile: (input: { defaultName: string; content: string }) =>
    ipcRenderer.invoke("marginalia:save-text-file", input)
});
