/** True only for http/https URLs we are willing to hand to the system browser. */
export function isExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
