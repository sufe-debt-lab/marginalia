import type { AgentPermission } from "./agent-client.js";

/** Declared by an operation after resolving its target; never inferred from shell text. */
export type ToolEffect = {
  kind: "read" | "create" | "overwrite" | "delete" | "execute" | "export" | "send";
  target: string;
};

export function evaluateEffect(
  permission: AgentPermission,
  effect: ToolEffect
): "allow" | "approve" | "deny" {
  if (permission === "readonly") return effect.kind === "read" ? "allow" : "deny";
  if (permission === "full") return "allow";
  return effect.kind === "read" || effect.kind === "create" ? "allow" : "approve";
}
