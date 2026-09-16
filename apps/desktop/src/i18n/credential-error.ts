import type { useTranslation } from "./useTranslation.js";

export function credentialError(message: string, t: ReturnType<typeof useTranslation>["t"]) {
  if (message === "credential_missing") return t("common.credentialMissing");
  if (message === "credential_store_unavailable") return t("common.credentialStoreUnavailable");
  if (message === "internal_error") return t("common.requestFailed");
  if (message === "agent_failed") return t("chat.runFailed");
  return message;
}
