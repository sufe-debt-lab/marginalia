/**
 * True only for absolute http/https URLs — the ones we hand to the system
 * browser. Anchors, mailto:, and relative paths are left to default handling.
 */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Open a URL in the user's default browser. In Electron this routes through the
 * preload bridge (which calls shell.openExternal in the main process); in a plain
 * browser / test environment it falls back to window.open.
 */
export function openExternal(url: string): void {
  if (window.marginalia?.openExternal) {
    void window.marginalia.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
