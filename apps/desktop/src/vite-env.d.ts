/// <reference types="vite/client" />

type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string }
  | { status: "failed"; error: string; logs: string[] };

type PiServerResponseEvent =
  | { type: "start"; status: number; statusText: string; headers: [string, string][] }
  | { type: "data"; chunk: Uint8Array }
  | { type: "end" }
  | { type: "error"; code: string };

type PiServerRequest = {
  path: string;
  method: string;
  headers: [string, string][];
  body?: string;
};

interface Window {
  marginalia?: {
    getPiServerStatus(): Promise<PiServerStatus>;
    restartPiServer(): Promise<PiServerStatus>;
    requestPiServer?(
      input: PiServerRequest,
      callback: (event: PiServerResponseEvent) => void
    ): () => void;
    runPackagedSmoke?(): Promise<
      | { status: "ready"; healthStatus: number; unauthenticatedStatus: number }
      | { status: "starting" | "unavailable" }
    >;
    pickWorkspaceDirectory?: () => Promise<string | null>;
    openExternal?: (url: string) => Promise<void>;
  };
}
