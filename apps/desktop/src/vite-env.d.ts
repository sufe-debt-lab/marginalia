/// <reference types="vite/client" />

type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string }
  | { status: "failed"; error: string; logs: string[] };

interface Window {
  marginalia?: {
    getPiServerStatus(): Promise<PiServerStatus>;
    restartPiServer(): Promise<PiServerStatus>;
    pickWorkspaceDirectory?: () => Promise<string | null>;
    openExternal?: (url: string) => Promise<void>;
  };
}
