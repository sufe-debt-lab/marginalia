import type { Components } from "react-markdown";
import { CodeBlock } from "../chat/CodeBlock.js";
import { isWebUrl, openExternal } from "./open-external.js";

export const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const raw = String(children).replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className || "");
    if (!match) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {raw}
        </code>
      );
    }
    const language = match[1]!;
    return <CodeBlock code={raw} language={language} />;
  },
  a({ children, href, ...rest }) {
    return (
      <a
        className="text-primary underline"
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => {
          // Only redirect real web links to the system browser; let anchors,
          // mailto:, and relative paths keep their default behavior.
          if (!href || !isWebUrl(href)) return;
          event.preventDefault();
          openExternal(href);
        }}
        {...rest}
      >
        {children}
      </a>
    );
  },
  table: (props) => (
    <div className="my-2 overflow-x-auto">
      <table
        className="w-full border-collapse text-[13px] [&_td]:border [&_td]:border-soft [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-soft [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1 [&_th]:text-left"
        {...props}
      />
    </div>
  ),
  blockquote: (props) => (
    <blockquote className="my-2 border-l-2 border-brand/40 pl-3 text-text-muted" {...props} />
  )
};
