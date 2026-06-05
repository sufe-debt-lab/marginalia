import type { Provider } from "@/api/client.js";

/**
 * Resolve the effective provider/model for the composer. A stored selection
 * (persisted `composerProviderId`/`composerModel`) is only honoured while that
 * provider is still enabled; if it was disabled or deleted in settings we fall
 * back to the first enabled provider so sends don't post a stale id the run
 * endpoint would reject.
 */
export function resolveComposerSelection(
  enabled: readonly Provider[],
  storedProviderId: string | null,
  storedModel: string | null
): { providerId: string; model: string } {
  const selected = enabled.find((p) => p.id === storedProviderId) ?? enabled[0];
  if (!selected) return { providerId: "", model: "" };
  // Keep the stored model only when the stored provider is the one we kept.
  const usingStored = selected.id === storedProviderId;
  const model = usingStored && storedModel ? storedModel : selected.defaultModel || "";
  return { providerId: selected.id, model };
}
