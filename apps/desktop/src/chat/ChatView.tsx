import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/client.js";
import { useMessages } from "@/hooks/useMessages.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useStreamingChat } from "@/hooks/useStreamingChat.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { Composer } from "./Composer/Composer.js";
import { MessageStream } from "./MessageStream.js";

export function ChatView({ api, sessionId }: { api: ApiClient; sessionId: string }) {
  const { t } = useTranslation();
  const messages = useMessages(api, sessionId);
  const providers = useProviders(api);
  const pendingPrompt = useAppStore((s) => s.pendingPrompt);
  const setPendingPrompt = useAppStore((s) => s.setPendingPrompt);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const contextFiles = useAppStore((s) => s.contextFiles);
  const addContext = useAppStore((s) => s.addContextFile);
  const removeContext = useAppStore((s) => s.removeContextFile);

  const firstProvider = providers.data[0];
  const [providerId, setProviderId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const actualProviderId = providerId || firstProvider?.id || "";
  const actualModel = model || firstProvider?.defaultModel || "";
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const stream = useStreamingChat({
    api,
    sessionId,
    providerId: actualProviderId,
    model: actualModel,
    onUserAppend: messages.append,
    onAssistantStart: messages.append,
    onAssistantDelta: messages.appendToLast,
    onComplete: () => setError(null),
    onError: setError
  });

  function submit(text: string) {
    if (!actualProviderId) {
      setError(t("chat.noProvider"));
      return;
    }
    setError(null);
    setLastSent(text);
    void stream.send(text, [...contextFiles]);
  }

  // 消费 pendingPrompt 一次
  useEffect(() => {
    if (pendingPrompt && actualProviderId) {
      const text = pendingPrompt;
      setPendingPrompt(null);
      setLastSent(text);
      void stream.send(text, [...contextFiles]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, actualProviderId]);

  function retry() {
    if (lastSent) {
      setError(null);
      void stream.send(lastSent, [...contextFiles]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <MessageStream messages={messages.data} error={error} onRetry={retry} />
      </div>
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <Composer
            api={api}
            workspaceId={activeWorkspaceId}
            providers={providers.data}
            providerId={actualProviderId}
            model={actualModel}
            onModelChange={({ providerId: p, model: m }) => {
              setProviderId(p);
              setModel(m);
            }}
            contextFiles={contextFiles}
            onAddContextFile={addContext}
            onRemoveContextFile={removeContext}
            sending={stream.sending}
            onSubmit={submit}
            placeholder={t("composer.chatPlaceholder")}
          />
        </div>
      </div>
    </div>
  );
}
