import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, Approval } from "@/api/client.js";
import { useMessages } from "@/hooks/useMessages.js";
import { useProviders } from "@/hooks/useProviders.js";
import { resolveComposerSelection } from "@/lib/provider-selection.js";
import { useStreamingChat } from "@/hooks/useStreamingChat.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { Composer } from "./Composer/Composer.js";
import { extractMentions } from "./Composer/mentions.js";
import { MessageStream } from "./MessageStream.js";
import type { ApprovalDecision } from "./ToolCard.js";

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

  const enabledProviders = providers.enabled;
  // Honour the stored selection only while it's still enabled; otherwise fall back
  // so a disabled/deleted provider id is never sent to the run endpoint.
  const { providerId: actualProviderId, model: actualModel } = resolveComposerSelection(
    enabledProviders,
    composerProviderId,
    composerModel
  );
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ text: string; contextFiles: string[] } | null>(null);
  // Ids of the most recent optimistic pair, so a retry can drop them before resending.
  const lastUserIdRef = useRef<string | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);

  // Approvals keyed by toolCallId so a ToolCard can look up its own decision state.
  const [approvals, setApprovals] = useState<Map<string, Approval>>(new Map());

  // Reopen restore: load this session's persisted approvals whenever it changes.
  useEffect(() => {
    let cancelled = false;
    setApprovals(new Map());
    void api
      .listApprovals(sessionId)
      .then((list) => {
        if (cancelled) return;
        setApprovals(new Map(list.map((a) => [a.toolCallId, a])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, sessionId]);

  function upsertApproval(a: Approval) {
    setApprovals((prev) => new Map(prev).set(a.toolCallId, a));
  }

  const stream = useStreamingChat({
    api,
    sessionId,
    providerId: actualProviderId,
    model: actualModel,
    permission,
    reasoning,
    onUserAppend: (m) => {
      // New send: reset the assistant id (bubbles are now created lazily as content arrives).
      lastUserIdRef.current = m.id;
      lastAssistantIdRef.current = null;
      messages.append(m);
    },
    onAssistantStart: (m) => {
      lastAssistantIdRef.current = m.id;
      messages.append(m);
    },
    onAssistantReplace: messages.replaceAssistant,
    onAssistantDelta: messages.appendToLast,
    onToolCallUpsert: messages.upsertToolCall,
    onToolResultUpsert: messages.upsertToolResult,
    onApprovalRequested: (a) =>
      upsertApproval({
        id: a.approvalId,
        toolCallId: a.toolCallId,
        toolName: a.toolName,
        kind: a.payload.kind,
        payload: a.payload,
        status: "pending"
      }),
    onApprovalResolved: (u) =>
      setApprovals((prev) => {
        const existing = prev.get(u.toolCallId);
        if (!existing) return prev;
        const status = u.expired ? "expired" : u.approved ? "approved" : "denied";
        return new Map(prev).set(u.toolCallId, { ...existing, status, reason: u.reason ?? null });
      }),
    onComplete: () => setError(null),
    onError: setError
  });

  // Stable identity so approving/denying doesn't defeat MessageItem's memoization.
  const decideApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      try {
        await api.resolveApproval(sessionId, approvalId, decision);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [api, sessionId]
  );

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
    if (!lastSent) return;
    setError(null);
    // Drop the failed attempt's bubbles so the resend doesn't duplicate them.
    if (lastUserIdRef.current) messages.removeMessage(lastUserIdRef.current);
    if (lastAssistantIdRef.current) messages.removeMessage(lastAssistantIdRef.current);
    void stream.send(lastSent.text, lastSent.contextFiles);
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
          reasoning={stream.reasoning}
          approvalsByToolCallId={approvals}
          onDecideApproval={decideApproval}
        />
      </div>
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <Composer
            api={api}
            workspaceId={activeWorkspaceId}
            providers={enabledProviders}
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
