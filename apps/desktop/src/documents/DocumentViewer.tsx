import { lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocumentContent } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { highlightCode } from "@/lib/highlight.js";
import { markdownComponents } from "@/lib/markdown.js";
import { basename } from "./DocumentTabs.js";

const PdfPreview = lazy(() =>
  import("./PdfPreview.js").then((module) => ({ default: module.PdfPreview }))
);

function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

function isWordDocument(path: string, mime: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".doc") ||
    lower.endsWith(".docx") ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

interface Props {
  path: string | null;
  content: DocumentContent | null;
  loading: boolean;
  error: Error | null;
  fileUrl?: string;
}

export function DocumentViewer({ path, content, loading, error, fileUrl }: Props) {
  const { t } = useTranslation();
  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("docPanel.openFile")}</p>
        <p>{t("docPanel.selectFile")}</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("docPanel.loading")}
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
  const isPdf = content.mime === "application/pdf" || path.toLowerCase().endsWith(".pdf");
  const isImage = content.mime.startsWith("image/");
  const isAudio = content.mime.startsWith("audio/");
  const isVideo = content.mime.startsWith("video/");
  const lang = content.language ?? languageFromPath(path);

  return (
    <div className="flex h-full flex-col overflow-auto">
      {content.truncated && (
        <p className="border-b border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          {t("docPanel.truncated")}
        </p>
      )}
      <div className="min-h-0 flex-1 text-sm">
        {isPdf && fileUrl ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("docPanel.loading")}
              </div>
            }
          >
            <PdfPreview url={fileUrl} />
          </Suspense>
        ) : isImage && fileUrl ? (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={fileUrl}
              alt={basename(path)}
              className="max-h-full max-w-full rounded object-contain"
            />
          </div>
        ) : isVideo && fileUrl ? (
          <div className="flex h-full items-center justify-center p-4">
            <video
              src={fileUrl}
              controls
              preload="metadata"
              className="max-h-full max-w-full rounded"
            />
          </div>
        ) : isAudio && fileUrl ? (
          <div className="flex h-full items-center justify-center p-8">
            <audio src={fileUrl} controls preload="metadata" className="w-full" />
          </div>
        ) : isMarkdown ? (
          <div className="p-3 text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content.text}
            </ReactMarkdown>
          </div>
        ) : content.rawOnly ? (
          <UnsupportedPreview
            title={
              isWordDocument(path, content.mime)
                ? t("docPanel.wordPreviewUnsupported")
                : t("docPanel.previewUnsupported")
            }
          />
        ) : (
          <pre className="m-3 overflow-x-auto rounded-md bg-muted/40 p-3">
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

function UnsupportedPreview({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-xs text-muted-foreground">
        <p className="text-base leading-relaxed">{title}</p>
        <p className="mt-3 text-sm leading-relaxed">{t("docPanel.openOutside")}</p>
      </div>
    </div>
  );
}
