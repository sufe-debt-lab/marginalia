import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export type AvailabilityInput = {
  piProviderId: string;
  modelId: string;
};

export type AvailabilityResult = { ok: boolean; message: string };

type AvailableModel = { provider: string; id: string };

export class ModelAvailabilityChecker {
  constructor(private readonly registry: ModelRegistry) {}

  check(input: AvailabilityInput): AvailabilityResult {
    const available = this.registry.getAll() as unknown as AvailableModel[];
    const hit = available.find((m) => m.provider === input.piProviderId && m.id === input.modelId);
    if (hit) return { ok: true, message: "ok" };
    const sameProvider = available.filter((m) => m.provider === input.piProviderId);
    if (sameProvider.length === 0) {
      return {
        ok: false,
        message: `provider ${input.piProviderId} not registered`
      };
    }
    return {
      ok: false,
      message: `model ${input.modelId} not registered under ${input.piProviderId}`
    };
  }
}
