import { useState } from "react";
import { FolderOpen, FolderTree, Paperclip, Pencil, RotateCw, Search } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useDocumentContent } from "@/hooks/useDocumentContent.js";
import { useFileTree } from "@/hooks/useFileTree.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { DocumentTabs } from "./DocumentTabs.js";
import { DocumentTree } from "./DocumentTree.js";
import { DocumentViewer } from "./DocumentViewer.js";

export function DocumentPanel({ api, workspaceId }: { api: ApiClient; workspaceId: string }) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const tree = useFileTree(api, workspaceId);
  const doc = useDocumentContent(api, workspaceId, activeTab);
  const addContextFile = useAppStore((s) => s.addContextFile);

  // No tab open → file tree fills the panel. A tab open → split (narrow tree + viewer).
  const hasTab = activeTab !== null;
  const treeVisible = !hasTab || treeOpen;

  function openTab(path: string) {
    setTabs((existing) => (existing.includes(path) ? existing : [...existing, path]));
    setActiveTab(path);
  }

  function closeTab(path: string) {
    setTabs((existing) => {
      const next = existing.filter((p) => p !== path);
      setActiveTab((current) => (current !== path ? current : (next[next.length - 1] ?? null)));
      return next;
    });
  }

  const treeColumn = (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-surface-2 text-xs",
        hasTab ? "w-48 shrink-0 border-r border-border-soft" : "flex-1"
      )}
    >
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-text-subtle">
          <Search className="h-3 w-3" />
          <span className="text-[11.5px]">{t("docPanel.filterFiles")}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {tree.loading ? (
          <p className="px-2 py-1 text-text-muted">{t("docPanel.loading")}</p>
        ) : (
          <>
            <DocumentTree paths={tree.paths} onSelect={openTab} />
            <div data-testid="doc-tree-fallback" className="sr-only">
              {tree.paths.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={`Open ${p}`}
                  onClick={() => openTab(p)}
                  className="flex w-full truncate rounded px-2 py-1 text-left hover:bg-accent"
                >
                  {p}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {!hasTab && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border-soft px-3 py-2.5 text-[11.5px] text-text-faint">
          <FolderTree className="h-3 w-3" />
          <span>
            {tree.paths.length} {t("docPanel.filesSuffix")}
          </span>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <DocumentTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={() => setTreeOpen(true)}
      />

      {hasTab && (
        <div className="flex items-center gap-2 border-b border-border-soft bg-surface-2 px-3 py-1.5 text-[11.5px] text-text-muted">
          <FolderOpen className="h-3 w-3" />
          <span className="mono flex-1 truncate">{activeTab}</span>
          <button
            type="button"
            aria-label={t("docPanel.toggleTree")}
            onClick={() => setTreeOpen((v) => !v)}
            className={cn("rounded p-1 hover:bg-accent", treeOpen && "bg-accent text-foreground")}
          >
            <FolderTree className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Refresh" className="rounded p-1 hover:bg-accent">
            <RotateCw className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {treeVisible && treeColumn}
        {hasTab && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <DocumentViewer
                path={activeTab}
                content={doc.content}
                loading={doc.loading}
                error={doc.error}
              />
            </div>
            <div className="flex items-center gap-2 border-t border-border-soft bg-surface px-3 py-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => activeTab && addContextFile(activeTab)}
                aria-label={t("docPanel.attachToChat")}
              >
                <Paperclip className="mr-1 h-3 w-3" />
                {t("docPanel.attachToChat")}
              </Button>
              <Button variant="ghost" size="sm" disabled>
                <Pencil className="mr-1 h-3 w-3" />
                {t("docPanel.edit")}
              </Button>
              <span className="flex-1" />
              {doc.content && (
                <span className="mono text-[10.5px] text-text-faint">{doc.content.mime}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
