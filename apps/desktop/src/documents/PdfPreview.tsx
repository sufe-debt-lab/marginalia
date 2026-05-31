import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { useTranslation } from "@/i18n/useTranslation.js";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Status = "loading" | "ready" | "error";

export function PdfPreview({ url }: { url: string }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const fallbackError = t("docPanel.pdfPreviewFailed");

  useEffect(() => {
    let cancelled = false;
    const renderTasks: RenderTask[] = [];
    const target = containerRef.current;
    if (!target) return;
    // Non-null alias so the nested async render closure keeps the narrowed type.
    const container = target;

    container.replaceChildren();
    setStatus("loading");
    setError(null);

    const loadingTask = getDocument(url);

    async function render() {
      try {
        const pdf = await loadingTask.promise;
        const availableWidth = Math.max(240, container.clientWidth - 32);
        const maxPageWidth = Math.min(availableWidth, 760);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(1.8, Math.max(0.6, maxPageWidth / baseViewport.width));
          const viewport = page.getViewport({ scale });
          const dpr = window.devicePixelRatio || 1;

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          canvas.className = "block rounded-sm bg-white shadow-sm";

          const pageShell = document.createElement("div");
          pageShell.className = "flex justify-center px-4 py-5";
          pageShell.appendChild(canvas);
          container.appendChild(pageShell);

          const context = canvas.getContext("2d");
          if (!context) throw new Error(fallbackError);
          context.scale(dpr, dpr);

          const task = page.render({ canvas, canvasContext: context, viewport });
          renderTasks.push(task);
          await task.promise;
          // Drop the loading overlay as soon as the first page paints.
          if (!cancelled && pageNumber === 1) setStatus("ready");
        }

        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "RenderingCancelledException") return;
        setError(err instanceof Error ? err.message : fallbackError);
        setStatus("error");
      }
    }

    void render();

    return () => {
      cancelled = true;
      for (const task of renderTasks) task.cancel();
      void loadingTask.destroy();
      container.replaceChildren();
    };
  }, [fallbackError, url]);

  return (
    <div
      className="relative h-full overflow-auto bg-surface-2"
      aria-label={t("docPanel.pdfPreview")}
    >
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t("docPanel.loading")}
        </div>
      )}
      {status === "error" && (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <div>
            <p className="text-sm font-medium text-foreground">{t("docPanel.pdfPreviewFailed")}</p>
            {error && <p className="mt-2 text-xs text-muted-foreground">{error}</p>}
          </div>
        </div>
      )}
      <div ref={containerRef} className="min-h-full py-2" />
    </div>
  );
}
