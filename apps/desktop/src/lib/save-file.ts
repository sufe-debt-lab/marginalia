type SaveResult = { saved: boolean; path?: string };
type MarginaliaBridge = {
  saveTextFile?: (input: { defaultName: string; content: string }) => Promise<SaveResult>;
};

/**
 * Save text content to disk via the Electron bridge. In a plain browser / test
 * environment (no `window.marginalia.saveTextFile`), resolves to `{ saved: false }`
 * instead of throwing, so callers can render the export button unconditionally.
 */
export async function saveTextFile(defaultName: string, content: string): Promise<SaveResult> {
  const bridge = (window as { marginalia?: MarginaliaBridge }).marginalia;
  if (!bridge?.saveTextFile) return { saved: false };
  return bridge.saveTextFile({ defaultName, content });
}
