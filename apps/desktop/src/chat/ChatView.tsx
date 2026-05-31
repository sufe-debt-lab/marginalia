import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/client.js";
import { useMessages } from "@/hooks/useMessages.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useStreamingChat } from "@/hooks/useStreamingChat.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { Composer } from "./Composer/Composer.js";
import { extractMentions } from "./Composer/mentions.js";
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
  const clearContextFiles = useAppStore((s) => s.clearContextFiles);
  const composerProviderId = useAppStore((s) => s.composerProviderId);
  const composerModel = useAppStore((s) => s.composerModel);
  const setComposerModel = useAppStore((s) => s.setComposerModel);
  const permission = useAppStore((s) => s.permission);
  const reasoning = useAppStore((s) => s.reasoning);
  const setPermission = useAppStore((s) => s.setPermission);
  const setReasoning = useAppStore((s) => s.setReasoning);

  const firstProvider = providers.data[0];
  const actualProviderId = composerProviderId || firstProvider?.id || "";
  const actualModel = composerModel || firstProvider?.defaultModel || "";
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ text: string; contextFiles: string[] } | null>(null);

  const stream = useStreamingChat({
    api,
    sessionId,
    providerId: actualProviderId,
    model: actualModel,
    permission,
    reasoning,
    onUserAppend: messages.append,
    onAssistantStart: messages.append,
    onAssistantDelta: messages.appendToLast,
    onToolCallUpdate: messages.upsertToolCall,
    onComplete: () => setError(null),
    onError: setError
  });

  // `+` attachments (contextFiles) plus inline `@path` mentions from the text.
  function filesFor(text: string): string[] {
    return [...new Set([...contextFiles, ...extractMentions(text)])];
  }

  function submit(text: string) {
    if (!actualProviderId) {
      setError(t("chat.noProvider"));
      return;
    }
    setError(null);
    const files = filesFor(text);
    setLastSent({ text, contextFiles: files });
    clearContextFiles();
    void stream.send(text, files);
  }

  // 消费 pendingPrompt 一次
  useEffect(() => {
    if (pendingPrompt && actualProviderId) {
      const text = pendingPrompt;
      const files = filesFor(text);
      setPendingPrompt(null);
      setLastSent({ text, contextFiles: files });
      clearContextFiles();
      void stream.send(text, files);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, actualProviderId]);

  function retry() {
    if (lastSent) {
      setError(null);
      void stream.send(lastSent.text, lastSent.contextFiles);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <MessageStream
          messages={messages.data}
          error={error}
          onRetry={retry}
          model={actualModel || undefined}
          streaming={stream.sending}
          toolCalls={stream.toolCalls}
        />
      </div>
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <Composer
            api={api}
            workspaceId={activeWorkspaceId}
            providers={providers.data}
            providerId={actualProviderId}
            model={actualModel}
            onModelChange={({ providerId: p, model: m }) => setComposerModel(p, m)}
            contextFiles={contextFiles}
            onAddContextFile={addContext}
            onRemoveContextFile={removeContext}
            permission={permission}
            reasoning={reasoning}
            onPermissionChange={setPermission}
            onReasoningChange={setReasoning}
            sending={stream.sending}
            onStop={stream.stop}
            onSubmit={submit}
            placeholder={t("composer.chatPlaceholder")}
          />
        </div>
      </div>
    </div>
  );
}
