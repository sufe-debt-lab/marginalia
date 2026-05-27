import type { Components } from "react-markdown";
import { highlightCode } from "./highlight.js";

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
    const language = match[1];
    const html = highlightCode(raw, language);
    return (
      <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-3">
        <code
          className={`hljs font-mono text-xs ${className || ""}`}
          dangerouslySetInnerHTML={{ __html: html }}
          {...props}
        />
      </pre>
    );
  },
  a({ children, href, ...rest }) {
    return (
      <a className="text-primary underline" href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
};
