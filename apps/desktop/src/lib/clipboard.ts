/**
 * Write to the clipboard and report success instead of throwing, so callers
 * can flash feedback without every button needing its own try/catch.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
