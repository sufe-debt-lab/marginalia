import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, Approval } from "@/api/client.js";
import { useMessages } from "@/hooks/useMessages.js";
import { useProviders } from "@/hooks/useProviders.js";
import { resolveComposerSelection } from "@/lib/provider-selection.js";
import { useStreamingChat } from "@/hooks/useStreamingChat.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore, type TurnDraft, type TurnOwner } from "@/store/app-store.js";
import { mergeApprovals } from "./approval-merge.js";
import { Composer } from "./Composer/Composer.js";
import { extractMentions } from "./Composer/mentions.js";
import { MessageStream } from "./MessageStream.js";
import { SaveToWorkspaceDialog } from "./SaveToWorkspaceDialog.js";
import type { ApprovalDecision } from "./ToolCard.js";

function cloneTurnDraft(turn: TurnDraft): TurnDraft {
  return {
    text: turn.text,
    contextFiles: [...turn.contextFiles],
    skills: turn.skills.map((skill) => ({ ...skill }))
  };
}

function sameTurnDraft(left: TurnDraft, right: TurnDraft): boolean {
  return (
    left.text === right.text &&
    left.contextFiles.length === right.contextFiles.length &&
    left.contextFiles.every((path, index) => path === right.contextFiles[index]) &&
    left.skills.length === right.skills.length &&
    left.skills.every(
      (skill, index) =>
        skill.name === right.skills[index]?.name && skill.path === right.skills[index]?.path
    )
  );
}

type ChatErrorState = {
  message: string;
  accepted: boolean;
  retryable: boolean;
};

export function ChatView({ api, sessionId }: { api: ApiClient; sessionId: string }) {
  const { t } = useTranslation();
  const messages = useMessages(api, sessionId);
  const providers = useProviders(api);
  const owner: TurnOwner = `session:${sessionId}`;
  const draft = useAppStore((s) => s.turnDrafts[owner]);
  const setTurnText = useAppStore((s) => s.setTurnText);
  const addTurnContextFile = useAppStore((s) => s.addTurnContextFile);
  const removeTurnContextFile = useAppStore((s) => s.removeTurnContextFile);
  const clearTurnDraft = useAppStore((s) => s.clearTurnDraft);
  const getTurnDraft = useAppStore((s) => s.getTurnDraft);
  const claimPendingTurn = useAppStore((s) => s.claimPendingTurn);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
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
  const [error, setError] = useState<ChatErrorState | null>(null);
  const [lastSent, setLastSent] = useState<TurnDraft | null>(null);
  // Message queued for the save-to-workspace dialog: its markdown (write content)
  // plus the proposed file name. Null when the dialog is closed.
  const [saveTarget, setSaveTarget] = useState<{ markdown: string; defaultName: string } | null>(
    null
  );
  // All local entries created by the current attempt. A retry snapshots this
  // list so it can replace the complete failed attempt only after acceptance.
  const currentAttemptEntryIdsRef = useRef<string[]>([]);
  const pendingTurnRef = useRef<TurnDraft | null>(null);
  const claimedSessionRef = useRef<string | null>(null);
  const clearSnapshotRef = useRef<TurnDraft | null>(null);
  const lastSentRef = useRef<TurnDraft | null>(null);
  const retryCleanupRef = useRef<string[] | null>(null);

  // Approvals keyed by toolCallId so a ToolCard can look up its own decision state.
  const [approvals, setApprovals] = useState<Map<string, Approval>>(new Map());
  // Live tool output keyed by toolCallId; retired once that call's result arrives.
  const [toolProgress, setToolProgress] = useState<Map<string, string>>(new Map());

  // Reopen restore: load this session's persisted approvals whenever it changes.
  useEffect(() => {
    let cancelled = false;
    setApprovals(new Map());
    void api
      .listApprovals(sessionId)
      .then((list) => {
        if (cancelled) return;
        // Merge instead of replace: an approval that streamed in while this
        // fetch was in flight is newer than the snapshot and must survive.
        setApprovals((prev) => mergeApprovals(list, prev));
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
      currentAttemptEntryIdsRef.current = [m.id];
      setToolProgress(new Map());
      messages.append(m);
    },
    onAssistantStart: (m) => {
      currentAttemptEntryIdsRef.current.push(m.id);
      messages.append(m);
    },
    onAssistantReplace: messages.replaceAssistant,
    onAssistantDelta: messages.appendToLast,
    onToolCallUpsert: messages.upsertToolCall,
    onToolProgress: (toolCallId, output) =>
      setToolProgress((prev) => new Map(prev).set(toolCallId, output)),
    onToolResultUpsert: (entry) => {
      if (!currentAttemptEntryIdsRef.current.includes(entry.id)) {
        currentAttemptEntryIdsRef.current.push(entry.id);
      }
      // Result arrived: the live progress area retires in favor of the final result.
      setToolProgress((prev) => {
        if (!prev.has(entry.message.toolCallId)) return prev;
        const next = new Map(prev);
        next.delete(entry.message.toolCallId);
        return next;
      });
      messages.upsertToolResult(entry);
    },
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
    onAccepted: (turn) => {
      const retryCleanup = retryCleanupRef.current;
      retryCleanupRef.current = null;
      retryCleanup?.forEach(messages.removeMessage);
      const clearSnapshot = clearSnapshotRef.current;
      clearSnapshotRef.current = null;
      if (clearSnapshot && sameTurnDraft(getTurnDraft(owner), clearSnapshot)) {
        clearTurnDraft(owner);
      }
      const acceptedTurn = cloneTurnDraft(turn);
      lastSentRef.current = acceptedTurn;
      setLastSent(acceptedTurn);
    },
    onComplete: () => setError(null),
    onError: (streamError, accepted) => {
      if (!accepted) {
        clearSnapshotRef.current = null;
        retryCleanupRef.current = null;
      }
      setError({
        message: streamError.message,
        accepted,
        retryable: accepted && lastSentRef.current !== null
      });
    }
  });

  // Stable identity so approving/denying doesn't defeat MessageItem's memoization.
  const decideApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      try {
        await api.resolveApproval(sessionId, approvalId, decision);
      } catch (err) {
        setError({ message: (err as Error).message, accepted: false, retryable: false });
      }
    },
    [api, sessionId]
  );

  // Stable identity so a user hovering/saving one message doesn't defeat
  // MessageItem's memoization for every other message in the stream.
  const handleSaveMessage = useCallback(
    (markdown: string, defaultName: string) => setSaveTarget({ markdown, defaultName }),
    []
  );

  // User-initiated write into the workspace — deliberately bypasses the agent
  // tool-call approval flow; the overwrite-confirm step in the dialog itself
  // is the only gate. A "file exists" 409 surfaces as "exists" so the dialog
  // can ask before overwriting; any other failure just reports the error.
  async function handleSaveToWorkspace(
    fileName: string,
    overwrite: boolean
  ): Promise<"saved" | "exists"> {
    if (!activeWorkspaceId || !saveTarget) return "saved";
    try {
      await api.writeWorkspaceFile(activeWorkspaceId, {
        path: fileName,
        content: saveTarget.markdown,
        overwrite
      });
      setSaveTarget(null);
      return "saved";
    } catch (err) {
      if ((err as Error).message === "file exists") return "exists";
      setError({ message: (err as Error).message, accepted: false, retryable: false });
      setSaveTarget(null);
      return "saved";
    }
  }

  // `+` attachments plus inline `@path` mentions from the text.
  function withMentionedFiles(turn: TurnDraft): TurnDraft {
    return {
      text: turn.text,
      contextFiles: [...new Set([...turn.contextFiles, ...extractMentions(turn.text)])],
      skills: turn.skills.map((skill) => ({ ...skill }))
    };
  }

  function submit(turn: TurnDraft) {
    if (!actualProviderId) {
      setError({ message: t("chat.noProvider"), accepted: false, retryable: false });
      return;
    }
    setError(null);
    retryCleanupRef.current = null;
    clearSnapshotRef.current = cloneTurnDraft(turn);
    void stream.send(withMentionedFiles(turn));
  }

  // Claim the matching handoff once. The session draft remains until run_started.
  useEffect(() => {
    if (claimedSessionRef.current === sessionId) return;
    claimedSessionRef.current = sessionId;
    pendingTurnRef.current = claimPendingTurn(sessionId);
  }, [claimPendingTurn, sessionId]);

  useEffect(() => {
    const pending = pendingTurnRef.current;
    if (!pending || !actualProviderId) return;
    pendingTurnRef.current = null;
    setError(null);
    clearSnapshotRef.current = cloneTurnDraft(pending);
    void stream.send(withMentionedFiles(pending));
    // The claimed turn is nulled synchronously before send, so changes to the
    // hook callbacks cannot replay it on rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualProviderId, sessionId]);

  function retry() {
    if (!error?.retryable || !lastSent) return;
    setError(null);
    // Keep the failed attempt visible until the retry is accepted. A pre-start
    // rejection must not erase an accepted turn from the conversation.
    retryCleanupRef.current = [...currentAttemptEntryIdsRef.current];
    clearSnapshotRef.current = null;
    void stream.send(lastSent);
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
          approvalsByToolCallId={approvals}
          toolProgressByCallId={toolProgress}
          onDecideApproval={decideApproval}
          onSaveMessage={activeWorkspaceId ? handleSaveMessage : undefined}
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
            text={draft?.text ?? ""}
            onTextChange={(text) => setTurnText(owner, text)}
            contextFiles={draft?.contextFiles ?? []}
            onAddContextFile={(path) => addTurnContextFile(owner, path)}
            onRemoveContextFile={(path) => removeTurnContextFile(owner, path)}
            skills={draft?.skills ?? []}
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
      <SaveToWorkspaceDialog
        open={saveTarget !== null}
        defaultName={saveTarget?.defaultName ?? ""}
        onCancel={() => setSaveTarget(null)}
        onSave={handleSaveToWorkspace}
      />
    </div>
  );
}
