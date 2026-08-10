import { useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderTree, Paperclip, Pencil, RotateCw, Search } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { ResizeHandle } from "@/components/ResizeHandle.js";
import { Button } from "@/components/ui/button.js";
import { useDocumentContent } from "@/hooks/useDocumentContent.js";
import { useFileTree } from "@/hooks/useFileTree.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore, type TurnOwner } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { DocumentTabs, type Tab } from "./DocumentTabs.js";
import { DocumentTree } from "./DocumentTree.js";
import { DocumentViewer } from "./DocumentViewer.js";

/** Unique parent directory paths implied by a flat list of file paths. */
function derivedDirs(paths: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

function clampTreeWidth(width: number): number {
  return Math.max(160, Math.min(520, width));
}

export function DocumentPanel({
  api,
  workspaceId,
  workspaceName
}: {
  api: ApiClient;
  workspaceId: string;
  workspaceName?: string | null;
}) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(240);
  const [filter, setFilter] = useState("");
  const tree = useFileTree(api, workspaceId);
  const doc = useDocumentContent(api, workspaceId, activeTab);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const view = useAppStore((s) => s.view);
  const addTurnContextFile = useAppStore((s) => s.addTurnContextFile);
  const turnOwner: TurnOwner =
    view === "chat" && activeSessionId ? `session:${activeSessionId}` : `new:${workspaceId}`;

  // No tab open → file tree fills the panel. A tab open → split (narrow tree + viewer).
  const hasTab = activeTab !== null;
  const treeVisible = !hasTab || treeOpen;
  const [activeFileUrl, setActiveFileUrl] = useState<string>();
  useEffect(() => {
    setActiveFileUrl(undefined);
    if (!activeTab || !doc.content) return;
    const mime = doc.content.mime;
    const needsRawPreview =
      mime === "application/pdf" ||
      mime.startsWith("image/") ||
      mime.startsWith("audio/") ||
      mime.startsWith("video/");
    if (!needsRawPreview) return;

    let disposed = false;
    let objectUrl: string | undefined;
    void api
      .readRawDocument(workspaceId, activeTab)
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setActiveFileUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeTab, api, doc.content, workspaceId]);

  // Directory paths implied by the tree. Folder rows only expand/collapse
  // (handled by @pierre/trees) — never open a tab — so opening guards against them.
  const allDirs = useMemo(() => derivedDirs(tree.paths), [tree.paths]);

  const needle = filter.trim().toLowerCase();
  const visiblePaths = useMemo(
    () => (needle ? tree.paths.filter((p) => p.toLowerCase().includes(needle)) : tree.paths),
    [tree.paths, needle]
  );
  const visibleDirs = useMemo(
    () => [...allDirs].filter((d) => visiblePaths.some((p) => p.startsWith(d + "/"))),
    [allDirs, visiblePaths]
  );

  // O(1) lookup instead of O(n) includes() on every openTab call
  const treePathSet = useMemo(() => new Set(tree.paths), [tree.paths]);

  function openTab(path: string) {
    if (allDirs.has(path) || !treePathSet.has(path)) return;

    setTabs((existing) => {
      // If path already open, just switch to it (no tab change)
      if (existing.some((t) => t.path === path)) {
        return existing;
      }

      // Find current active tab - check from existing tabs (avoids stale closure)
      const activeTabData = activeTab ? existing.find((t) => t.path === activeTab) : null;

      // If current tab exists and is NOT pinned, replace it instead of adding new tab
      if (activeTab && activeTabData && !activeTabData.pinned) {
        return existing.map((t) => (t.path === activeTab ? { ...t, path } : t));
      }

      // Otherwise add new tab
      return [...existing, { path, pinned: false }];
    });

    // Set activeTab outside setTabs to avoid stale closure
    setActiveTab(path);
  }

  function closeTab(path: string) {
    setTabs((existing) => {
      const next = existing.filter((t) => t.path !== path);
      setActiveTab((current) =>
        current !== path ? current : (next[next.length - 1]?.path ?? null)
      );
      return next;
    });
  }

  function togglePin(path: string) {
    setTabs((existing) => existing.map((t) => (t.path === path ? { ...t, pinned: !t.pinned } : t)));
  }

  const treeColumn = (
    <div
      className={cn(
        "relative flex min-h-0 flex-col bg-surface-2 text-xs",
        hasTab ? "shrink-0 border-r border-border-soft" : "flex-1"
      )}
      style={hasTab ? { width: treeWidth } : undefined}
    >
      <div className="px-3 pb-2 pt-3">
        <div className="flex h-9 items-center gap-2 rounded-[14px] border border-border bg-surface px-3 text-text-muted shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-[border-color,box-shadow,background-color] focus-within:border-border-strong focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]">
          <Search className="h-4 w-4 shrink-0 text-text-subtle" strokeWidth={1.8} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("docPanel.filterFiles")}
            aria-label={t("docPanel.filterFiles")}
            className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] text-foreground shadow-none outline-none ring-0 placeholder:text-text-subtle focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:shadow-none focus-visible:outline-none focus-visible:ring-0"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {tree.loading ? (
          <p className="px-2 py-1 text-text-muted">{t("docPanel.loading")}</p>
        ) : (
          <>
            <DocumentTree paths={visiblePaths} onSelect={openTab} />
            {/* Test-only seam: @pierre/trees renders to a canvas-like tree that
                jsdom can't click. Gated to Vitest so it never ships in prod/dev DOM.
                Folder rows are derived (mirrors pierre) so the folder-guard is
                exercisable: clicking a folder must only expand, never open a tab. */}
            {import.meta.env.MODE === "test" && (
              <div data-testid="doc-tree-fallback" className="sr-only">
                {visibleDirs.map((d) => (
                  <button
                    key={`dir:${d}`}
                    type="button"
                    aria-label={`Open ${d}`}
                    onClick={() => openTab(d)}
                  >
                    {d}
                  </button>
                ))}
                {visiblePaths.map((p) => (
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
            )}
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
      {hasTab && (
        <ResizeHandle
          side="right"
          getWidth={() => treeWidth}
          onWidth={(next) => setTreeWidth(clampTreeWidth(next))}
        />
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
        onPin={togglePin}
        workspaceName={workspaceName}
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
          <button
            type="button"
            aria-label={t("docPanel.refresh")}
            className="rounded p-1 hover:bg-accent"
          >
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
                fileUrl={activeFileUrl}
              />
            </div>
            <div className="flex items-center gap-2 border-t border-border-soft bg-surface px-3 py-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => activeTab && addTurnContextFile(turnOwner, activeTab)}
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
