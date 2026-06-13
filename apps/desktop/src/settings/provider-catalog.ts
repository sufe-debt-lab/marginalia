import type { Provider } from "@/api/client.js";

/**
 * Curated provider presets for quick-add (mirrors agent-harness/CodePilot's
 * VENDOR_PRESETS, trimmed to the four the product targets). `name` is what we
 * send to pi-server's createProvider — it maps to the pi runtime provider id
 * via piProviderId() (e.g. "MiniMax" → "minimax-cn").
 */
export interface PresetModel {
  id: string;
  label: string;
  tag?: string;
}

export interface ProviderPreset {
  key: string;
  /** provider.name sent to the API; chosen so piProviderId() resolves correctly. */
  name: string;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  baseUrl: string;
  defaultModel: string;
  models: PresetModel[];
  apiKeyUrl?: string;
  billing: "pay_as_you_go" | "token_plan" | "coding_plan";
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "openai",
    name: "OpenAI",
    label: "OpenAI",
    labelZh: "OpenAI",
    description: "Official OpenAI API",
    descriptionZh: "OpenAI 官方 API",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.1",
    models: [
      { id: "gpt-5.1", label: "gpt-5.1", tag: "default" },
      { id: "gpt-5.1-mini", label: "gpt-5.1-mini", tag: "fast" },
      { id: "o3-mini", label: "o3-mini", tag: "reasoning" }
    ],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    billing: "pay_as_you_go"
  },
  {
    key: "glm-cn",
    name: "GLM",
    label: "GLM (CN)",
    labelZh: "智谱 GLM（中国区）",
    description: "Zhipu GLM Coding Plan — China region",
    descriptionZh: "智谱 GLM 编程套餐 — 中国区",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    defaultModel: "glm-4.6",
    models: [
      { id: "glm-4.6", label: "GLM-4.6", tag: "default" },
      { id: "glm-4.5-air", label: "GLM-4.5-Air", tag: "fast" }
    ],
    apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    billing: "coding_plan"
  },
  {
    key: "minimax-cn",
    name: "MiniMax",
    label: "MiniMax (CN)",
    labelZh: "MiniMax（中国区）",
    description: "MiniMax Code Plan — China region",
    descriptionZh: "MiniMax 编程套餐 — 中国区",
    baseUrl: "https://api.minimaxi.com/anthropic",
    defaultModel: "MiniMax-M2.7",
    models: [{ id: "MiniMax-M2.7", label: "MiniMax-M2.7", tag: "default" }],
    apiKeyUrl: "https://platform.minimaxi.com/user-center/payment/token-plan",
    billing: "token_plan"
  },
  {
    key: "xiaomi-mimo-token-plan",
    name: "Xiaomi MiMo",
    label: "Xiaomi MiMo",
    labelZh: "小米 MiMo",
    description: "Xiaomi MiMo Token Plan subscription",
    descriptionZh: "小米 MiMo Token Plan 订阅套餐",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    defaultModel: "mimo-v2.5-pro",
    models: [{ id: "mimo-v2.5-pro", label: "MiMo-V2.5-Pro", tag: "default" }],
    apiKeyUrl: "https://platform.xiaomimimo.com/#/console/plan-manage",
    billing: "token_plan"
  }
];

/** Locale-aware preset display name. */
export function presetLabel(preset: ProviderPreset, locale: "en" | "zh"): string {
  return locale === "zh" ? preset.labelZh : preset.label;
}

/** Locale-aware preset description. */
export function presetDescription(preset: ProviderPreset, locale: "en" | "zh"): string {
  return locale === "zh" ? preset.descriptionZh : preset.description;
}

/** Presets the user hasn't configured yet — rendered in the "Others" group. */
export function unconfiguredPresets(
  providers: readonly Pick<Provider, "name">[]
): ProviderPreset[] {
  const have = new Set(providers.map((p) => p.name.trim().toLowerCase()));
  return PROVIDER_PRESETS.filter((p) => !have.has(p.name.toLowerCase()));
}

/** Match a stored provider back to its preset (by base URL first, then name). */
export function findPreset(
  provider: Pick<Provider, "name" | "baseUrl">
): ProviderPreset | undefined {
  const url = (provider.baseUrl ?? "").toLowerCase();
  if (url) {
    const byUrl = PROVIDER_PRESETS.find((p) => url.includes(new URL(p.baseUrl).hostname));
    if (byUrl) return byUrl;
  }
  const name = provider.name.trim().toLowerCase();
  return PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === name);
}

/** Model rows to show under a provider: its preset catalog, else its single default model. */
export function modelsForProvider(provider: Provider): PresetModel[] {
  const preset = findPreset(provider);
  if (preset) return preset.models;
  return provider.defaultModel
    ? [{ id: provider.defaultModel, label: provider.defaultModel, tag: "default" }]
    : [];
}
