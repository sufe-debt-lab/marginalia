import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { markdownComponents } from "@/lib/markdown.js";

function MessageItemImpl({ message }: { message: Message }) {
  const { t } = useTranslation();
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-surface-3 px-3.5 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {t("chat.assistant")}
      </span>
      <div className="text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
