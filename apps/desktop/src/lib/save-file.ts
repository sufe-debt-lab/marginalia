type SaveResult = { saved: boolean; path?: string; error?: string };
type MarginaliaBridge = {
  saveTextFile?: (input: { defaultName: string; content: string }) => Promise<SaveResult>;
};

/**
 * Save text content to disk via the Electron bridge. Never throws: a missing
 * bridge (plain browser / test environment) resolves `{ saved: false }`, and a
 * bridge failure resolves `{ saved: false, error }`, so callers can render the
 * export button unconditionally and flash feedback from the result alone.
 * A user-cancelled dialog is `{ saved: false }` with no error.
 */
export async function saveTextFile(defaultName: string, content: string): Promise<SaveResult> {
  const bridge = (window as { marginalia?: MarginaliaBridge }).marginalia;
  if (!bridge?.saveTextFile) return { saved: false };
  try {
    return await bridge.saveTextFile({ defaultName, content });
  } catch (err) {
    return { saved: false, error: (err as Error).message };
  }
}
