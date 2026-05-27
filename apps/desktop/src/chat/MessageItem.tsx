import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/api/client.js";
import { markdownComponents } from "@/lib/markdown.js";

function MessageItemImpl({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">assistant</span>
      <div className="text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
