import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stringifyContent } from "@marginalia/chat-core";
import type { ChatEntry, ChatToolResult } from "@marginalia/chat-core";
import type { Approval } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { createMarkdownComponents } from "@/lib/markdown.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard, type ApprovalDecision } from "./ToolCard.js";

function MessageItemImpl({
  entry,
  model,
  streaming,
  toolResultsByCallId,
  approvalsByToolCallId,
  toolProgressByCallId,
  onDecideApproval
}: {
  entry: ChatEntry;
  model?: string;
  streaming?: boolean;
  toolResultsByCallId?: ReadonlyMap<string, ChatToolResult>;
  approvalsByToolCallId?: ReadonlyMap<string, Approval>;
  toolProgressByCallId?: ReadonlyMap<string, string>;
  onDecideApproval?: (approvalId: string, decision: ApprovalDecision) => void;
}) {
  const { t } = useTranslation();
  const message = entry.message;
  // Stateless (node-derived) heading ids, so memoizing on entry.id is safe —
  // no render-time counter to drift across re-renders.
  const markdownComponents = useMemo(() => createMarkdownComponents(entry.id), [entry.id]);
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-surface-3 px-3.5 py-2.5 text-sm leading-relaxed">
          {stringifyContent(message.content)}
        </div>
      </div>
    );
  }
  if (message.role === "toolResult") return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {t("chat.assistant")}
        {model && <span className="lowercase"> · {model}</span>}
      </span>
      <div className="flex flex-col gap-2 text-sm leading-relaxed">
        {message.content.map((part, index) => {
          if (part.type === "text") {
            return (
              <div key={`${index}:text`} className="max-w-[72ch] font-serif leading-7">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {part.text}
                </ReactMarkdown>
              </div>
            );
          }
          if (part.type === "thinking") {
            return (
              <ThinkingBlock
                key={`${index}:thinking`}
                text={part.thinking}
                streaming={Boolean(streaming) && index === message.content.length - 1}
              />
            );
          }
          return (
            <ToolCard
              key={part.id}
              call={part}
              result={toolResultsByCallId?.get(part.id)}
              approval={approvalsByToolCallId?.get(part.id)}
              progress={toolProgressByCallId?.get(part.id)}
              onDecideApproval={onDecideApproval}
            />
          );
        })}
        {streaming && <span className="caret" aria-hidden />}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
