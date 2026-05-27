import { useState } from "react";
import { FolderTree } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useDocumentContent } from "@/hooks/useDocumentContent.js";
import { useFileTree } from "@/hooks/useFileTree.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { DocumentTabs } from "./DocumentTabs.js";
import { DocumentTree } from "./DocumentTree.js";
import { DocumentViewer } from "./DocumentViewer.js";

export function DocumentPanel({ api, workspaceId }: { api: ApiClient; workspaceId: string }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const tree = useFileTree(api, workspaceId);
  const doc = useDocumentContent(api, workspaceId, activeTab);
  const addContextFile = useAppStore((s) => s.addContextFile);

  function openTab(path: string) {
    setTabs((existing) => (existing.includes(path) ? existing : [...existing, path]));
    setActiveTab(path);
  }

  function closeTab(path: string) {
    setTabs((existing) => {
      const next = existing.filter((p) => p !== path);
      setActiveTab((current) => {
        if (current !== path) return current;
        return next[next.length - 1] ?? null;
      });
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <DocumentTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={() => setTreeOpen(true)}
      />
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5 text-xs">
        <span className="flex-1 truncate text-muted-foreground">{activeTab ?? "/"}</span>
        <button
          type="button"
          aria-label="Toggle file tree"
          onClick={() => setTreeOpen((v) => !v)}
          className={cn(
            "rounded p-1 hover:bg-accent",
            treeOpen && "bg-accent text-foreground"
          )}
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {treeOpen && (
          <div className="w-48 border-r border-border bg-muted/10 text-xs">
            {tree.loading && <p className="p-2 text-muted-foreground">Loading…</p>}
            {!tree.loading && (
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
        )}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <DocumentViewer
              path={activeTab}
              content={doc.content}
              loading={doc.loading}
              error={doc.error}
            />
          </div>
          {activeTab && (
            <div className="border-t border-border bg-background px-3 py-2 text-right">
              <Button
                variant="outline"
                size="sm"
                onClick={() => addContextFile(activeTab)}
                aria-label="Attach to chat"
              >
                Attach to chat
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
