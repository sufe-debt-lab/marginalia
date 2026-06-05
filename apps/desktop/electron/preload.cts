import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: () => ipcRenderer.invoke("pi-server:status"),
  restartPiServer: () => ipcRenderer.invoke("pi-server:restart"),
  pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
  openExternal: (url: string) => ipcRenderer.invoke("marginalia:open-external", url)
});
