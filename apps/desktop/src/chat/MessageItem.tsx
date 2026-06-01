import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stringifyContent } from "@marginalia/chat-core";
import type { ChatEntry, ChatToolResult } from "@marginalia/chat-core";
import { useTranslation } from "@/i18n/useTranslation.js";
import { markdownComponents } from "@/lib/markdown.js";
import { ToolCard } from "./ToolCard.js";

function MessageItemImpl({
  entry,
  model,
  streaming,
  toolResultsByCallId
}: {
  entry: ChatEntry;
  model?: string;
  streaming?: boolean;
  toolResultsByCallId?: ReadonlyMap<string, ChatToolResult>;
}) {
  const { t } = useTranslation();
  const message = entry.message;
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
              <ReactMarkdown
                key={`${index}:text`}
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {part.text}
              </ReactMarkdown>
            );
          }
          if (part.type === "thinking") {
            return (
              <div
                key={`${index}:thinking`}
                className="whitespace-pre-wrap border-l border-border pl-3 text-[12.5px] italic text-text-muted"
              >
                {part.thinking}
              </div>
            );
          }
          return (
            <ToolCard
              key={part.id}
              call={part}
              result={toolResultsByCallId?.get(part.id)}
            />
          );
        })}
        {streaming && <span className="caret" aria-hidden />}
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
