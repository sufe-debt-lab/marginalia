import { contextBridge, ipcRenderer } from "electron";

type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string; capabilityToken: string }
  | { status: "failed"; error: string; logs: string[] };

contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: (): Promise<PiServerStatus> => ipcRenderer.invoke("pi-server:status"),
  restartPiServer: (): Promise<PiServerStatus> => ipcRenderer.invoke("pi-server:restart"),
  pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
  openExternal: (url: string) => ipcRenderer.invoke("marginalia:open-external", url),
  saveTextFile: (input: { defaultName: string; content: string }) =>
    ipcRenderer.invoke("marginalia:save-text-file", input)
});
