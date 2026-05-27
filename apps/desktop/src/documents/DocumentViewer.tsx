import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocumentContent } from "@/api/client.js";
import { highlightCode } from "@/lib/highlight.js";
import { markdownComponents } from "@/lib/markdown.js";

function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

interface Props {
  path: string | null;
  content: DocumentContent | null;
  loading: boolean;
  error: Error | null;
}

export function DocumentViewer({ path, content, loading, error }: Props) {
  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Open file</p>
        <p>Select a file from the workspace tree</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error.message}
      </div>
    );
  }
  if (!content) return null;

  const isMarkdown = path.endsWith(".md") || content.mime === "text/markdown";
  const lang = languageFromPath(path);

  return (
    <div className="flex h-full flex-col overflow-auto">
      {content.truncated && (
        <p className="border-b border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          File truncated for preview.
        </p>
      )}
      <div className="flex-1 p-3 text-sm">
        {isMarkdown ? (
          <div className="text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content.text}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-3">
            <code
              className="hljs font-mono text-xs"
              dangerouslySetInnerHTML={{ __html: highlightCode(content.text, lang) }}
            />
          </pre>
        )}
      </div>
    </div>
  );
}
