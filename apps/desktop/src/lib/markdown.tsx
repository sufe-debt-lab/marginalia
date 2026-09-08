import type { Components } from "react-markdown";
import type { Element } from "hast";
import { CodeBlock } from "../chat/CodeBlock.js";
import { isWebUrl, openExternal } from "./open-external.js";

/**
 * Pull the raw code text and language out of the hast `<pre><code>` pair so the
 * `pre` component can replace the whole block with CodeBlock. Reading the hast
 * node (not rendered children) keeps this independent of the `code` component.
 */
function fencedCode(node: Element | undefined): { code: string; language: string } | null {
  const child = node?.children[0];
  if (!child || child.type !== "element" || child.tagName !== "code") return null;
  const classes = child.properties.className;
  const classText = Array.isArray(classes)
    ? classes.join(" ")
    : typeof classes === "string"
      ? classes
      : "";
  const language = /language-([\w+.-]+)/.exec(classText)?.[1] ?? "text";
  const code = child.children.map((c) => (c.type === "text" ? c.value : "")).join("");
  return { code: code.replace(/\n$/, ""), language };
}

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
    // Fenced blocks are handled here (not in `code`) so CodeBlock's <div> never
    // nests inside react-markdown's default <pre> — with or without a language tag.
    pre({ node, children }) {
      const fenced = fencedCode(node);
      if (!fenced) return <pre>{children}</pre>;
      return <CodeBlock code={fenced.code} language={fenced.language} />;
    },
    code({ children, ...props }) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {String(children).replace(/\n$/, "")}
        </code>
      );
    },
    a({ children, href, ...rest }) {
      // Only real web links leave the app (system browser + new-window
      // semantics); anchors, mailto:, and relative paths keep their default
      // in-page behavior and must not get target="_blank".
      const web = Boolean(href) && isWebUrl(href!);
      return (
        <a
          className="text-primary underline"
          href={href}
          {...(web ? { target: "_blank", rel: "noreferrer" } : {})}
          onClick={(event) => {
            if (!web) return;
            event.preventDefault();
            openExternal(href!);
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
          className="w-full border-collapse text-[13px] [&_td]:border [&_td]:border-border-soft [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border-soft [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1 [&_th]:text-left"
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
