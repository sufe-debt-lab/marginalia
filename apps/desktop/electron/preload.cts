import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: () => ipcRenderer.invoke("pi-server:status"),
  restartPiServer: () => ipcRenderer.invoke("pi-server:restart"),
  pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
  captureScreenshot: (label: string) => ipcRenderer.invoke("marginalia:capture-screenshot", label)
});
