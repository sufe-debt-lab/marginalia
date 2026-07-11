import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stringifyContent } from "@marginalia/chat-core";
import type { ChatEntry, ChatToolResult } from "@marginalia/chat-core";
import type { Approval } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { createMarkdownComponents } from "@/lib/markdown.js";
import { MessageActions } from "./MessageActions.js";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { ToolCard, type ApprovalDecision } from "./ToolCard.js";
import { extractHeadings, MessageToc } from "./MessageToc.js";

// Strip common markdown emphasis/code markers before slugging so headings like
// "**Summary**" or "`foo`" don't carry punctuation into the file name.
function slugifyHeading(text: string): string {
  return text
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const FALLBACK_SAVE_NAME = "marginalia-笔记.md";

function MessageItemImpl({
  entry,
  model,
  streaming,
  toolResultsByCallId,
  approvalsByToolCallId,
  toolProgressByCallId,
  onDecideApproval,
  onSaveMessage
}: {
  entry: ChatEntry;
  model?: string;
  streaming?: boolean;
  toolResultsByCallId?: ReadonlyMap<string, ChatToolResult>;
  approvalsByToolCallId?: ReadonlyMap<string, Approval>;
  toolProgressByCallId?: ReadonlyMap<string, string>;
  onDecideApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onSaveMessage?: (markdown: string, defaultName: string) => void;
}) {
  const { t } = useTranslation();
  const message = entry.message;
  // Stateless (node-derived) heading ids, so memoizing on entry.id is safe —
  // no render-time counter to drift across re-renders.
  const markdownComponents = useMemo(() => createMarkdownComponents(entry.id), [entry.id]);

  // Extract headings from the first text part for the outline.
  // Note: We only generate an outline for the first text part. While assistant messages
  // with multiple text parts are rare, this keeps the outline focused on the main content.
  // For user/toolResult messages, message.content is not an array, so we guard with an array check.
  const firstTextPart = useMemo(() => {
    if (Array.isArray(message.content)) {
      return message.content.find((part) => part.type === "text");
    }
    return undefined;
  }, [message.content]);

  const headings = useMemo(() => {
    if (firstTextPart?.type === "text") {
      return extractHeadings(firstTextPart.text);
    }
    return [];
  }, [firstTextPart]);

  // Full markdown for the message actions bar (copy / export) — all text parts
  // concatenated, tool calls and thinking excluded (stringifyContent skips them).
  const markdown = useMemo(() => stringifyContent(message.content), [message.content]);

  // Default file name for the save-to-workspace dialog: slug of the first
  // heading in the message, or a fixed fallback when there's no heading.
  const saveDefaultName = useMemo(() => {
    const slug = headings[0] ? slugifyHeading(headings[0].text) : "";
    return slug ? `${slug}.md` : FALLBACK_SAVE_NAME;
  }, [headings]);

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

  const hasMarkdown = markdown.trim().length > 0;

  return (
    <div className="group relative flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {t("chat.assistant")}
        {model && <span className="lowercase"> · {model}</span>}
      </span>
      {hasMarkdown && (
        <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <MessageActions
            markdown={markdown}
            defaultName={`marginalia-${entry.id.slice(0, 6)}.md`}
            onSaveToWorkspace={
              onSaveMessage ? () => onSaveMessage(markdown, saveDefaultName) : undefined
            }
          />
        </div>
      )}
      <div className="flex flex-col gap-2 text-sm leading-relaxed">
        {message.content.map((part, index) => {
          if (part.type === "text") {
            return (
              <div key={`${index}:text`} className="max-w-[72ch] font-serif leading-7">
                {index === 0 && headings.length >= 3 && (
                  <MessageToc items={headings} prefix={entry.id} />
                )}
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
