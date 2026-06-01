export function piProviderId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (!normalized) return "";
  if (normalized === "minimax" || normalized === "minimax-cn") return "minimax-cn";
  if (normalized === "minimax-global") return "minimax";
  if (normalized === "open-ai" || normalized === "openai") return "openai";
  return normalized;
}
