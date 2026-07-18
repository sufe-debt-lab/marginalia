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

interface MessageItemProps {
  entry: ChatEntry;
  model?: string;
  streaming?: boolean;
  toolResultsByCallId?: ReadonlyMap<string, ChatToolResult>;
  approvalsByToolCallId?: ReadonlyMap<string, Approval>;
  toolProgressByCallId?: ReadonlyMap<string, string>;
  onDecideApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onSaveMessage?: (markdown: string, defaultName: string) => void;
}

function MessageItemImpl({
  entry,
  model,
  streaming,
  toolResultsByCallId,
  approvalsByToolCallId,
  toolProgressByCallId,
  onDecideApproval,
  onSaveMessage
}: MessageItemProps) {
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

  // Default file name for both export and save-to-workspace: slug of the first
  // heading in the message, or a localized fallback when there's no heading.
  const fallbackName = t("message.defaultSaveName");
  const saveDefaultName = useMemo(() => {
    const slug = headings[0] ? slugifyHeading(headings[0].text) : "";
    return slug ? `${slug}.md` : fallbackName;
  }, [headings, fallbackName]);

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
        // focus-within keeps the bar visible while any of its buttons holds
        // keyboard focus — hover-only visibility would hide the focused control.
        <div className="absolute -top-2 right-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <MessageActions
            markdown={markdown}
            defaultName={saveDefaultName}
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

/**
 * Prop equality for the memoized stream item. The three lookup maps get fresh
 * identities on every streaming event, but this message only cares about the
 * entries for its own tool calls — comparing just those lets one call's live
 * output re-render its own bubble without re-rendering the whole stream.
 */
export function areMessageItemPropsEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (
    prev.entry !== next.entry ||
    prev.model !== next.model ||
    prev.streaming !== next.streaming ||
    prev.onDecideApproval !== next.onDecideApproval ||
    prev.onSaveMessage !== next.onSaveMessage
  ) {
    return false;
  }
  const message = next.entry.message;
  if (message.role !== "assistant") return true;
  for (const part of message.content) {
    if (part.type !== "toolCall") continue;
    if (
      prev.toolResultsByCallId?.get(part.id) !== next.toolResultsByCallId?.get(part.id) ||
      prev.approvalsByToolCallId?.get(part.id) !== next.approvalsByToolCallId?.get(part.id) ||
      prev.toolProgressByCallId?.get(part.id) !== next.toolProgressByCallId?.get(part.id)
    ) {
      return false;
    }
  }
  return true;
}

export const MessageItem = memo(MessageItemImpl, areMessageItemPropsEqual);
