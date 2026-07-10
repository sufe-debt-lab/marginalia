import type { Components } from "react-markdown";
import type { Element } from "hast";
import { CodeBlock } from "../chat/CodeBlock.js";
import { isWebUrl, openExternal } from "./open-external.js";

export function createMarkdownComponents(prefix?: string): Components {
  const headingId = (node: Element | undefined): string | undefined => {
    if (!prefix) return undefined;
    const line = node?.position?.start.line;
    return line ? `${prefix}-h-${line}` : `${prefix}-h`;
  };
  const heading =
    (Tag: "h1" | "h2" | "h3" | "h4", className: string) =>
    ({ node, children }: { node?: Element; children?: React.ReactNode }) => (
      <Tag id={headingId(node)} className={className}>
        {children}
      </Tag>
    );

  return {
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
    ),
    h1: heading("h1", "mt-4 mb-2 text-[1.25em] font-semibold"),
    h2: heading("h2", "mt-3 mb-1.5 text-[1.15em] font-semibold"),
    h3: heading("h3", "mt-2.5 mb-1 text-[1.05em] font-semibold"),
    h4: heading("h4", "mt-2 mb-1 font-semibold"),
    p: (props) => <p className="my-1.5" {...props} />,
    ul: (props) => <ul className="my-1.5 list-disc pl-5" {...props} />,
    ol: (props) => <ol className="my-1.5 list-decimal pl-5" {...props} />
  };
}

export const markdownComponents: Components = createMarkdownComponents();
