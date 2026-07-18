import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileText, RefreshCw, Search } from "lucide-react";
import type { ApiClient, SkillCandidate, SkillSource, SkillStatus } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useSkillCatalog } from "@/hooks/useSkillCatalog.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { PaneHeader } from "./SettingsPrimitives.js";

export type SkillsPaneProps = {
  api: ApiClient;
  workspace: { id: string; name: string } | null;
};

type SkillContent = {
  path: string;
  content: string;
  truncated: boolean;
  bytesTotal: number;
};

const STATUS_KEYS = {
  effective: "settings.skillsStatusEffective",
  shadowed: "settings.skillsStatusShadowed",
  disabled: "settings.skillsStatusDisabled",
  invalid: "settings.skillsStatusInvalid"
} as const satisfies Record<SkillStatus, string>;

const SOURCE_KEYS = {
  workspace_marginalia: "settings.skillsSourceWorkspaceMarginalia",
  workspace_pi: "settings.skillsSourceWorkspacePi",
  ancestor_agents: "settings.skillsSourceAncestorAgents",
  user_marginalia: "settings.skillsSourceUserMarginalia",
  user_pi: "settings.skillsSourceUserPi",
  user_agents: "settings.skillsSourceUserAgents"
} as const satisfies Record<SkillSource, string>;

function matches(candidate: SkillCandidate, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    candidate.name,
    candidate.description,
    candidate.discoveredPath,
    candidate.canonicalPath
  ].some((value) => value?.toLocaleLowerCase().includes(needle) === true);
}

export function SkillsPane({ api, workspace }: SkillsPaneProps) {
  const { t } = useTranslation();
  const workspaceId = workspace?.id ?? null;
  const catalog = useSkillCatalog(api, workspaceId);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<{ path: string; workspaceId: string | null } | null>(
    null
  );
  const [content, setContent] = useState<SkillContent | null>(null);
  const [contentError, setContentError] = useState<Error | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [togglePath, setTogglePath] = useState<string | null>(null);
  const [toggleFailed, setToggleFailed] = useState(false);
  const contentRequestId = useRef(0);
  const toggleRequestId = useRef(0);
  const toggleOperationRef = useRef<{
    requestId: number;
    workspaceId: string | null;
    path: string;
  } | null>(null);
  const workspaceRef = useRef(workspaceId);
  const selectionRef = useRef(selection);
  workspaceRef.current = workspaceId;
  selectionRef.current = selection;

  const candidates = useMemo(() => catalog.snapshot?.candidates ?? [], [catalog.snapshot]);
  const filteredCandidates = useMemo(
    () => candidates.filter((candidate) => matches(candidate, query)),
    [candidates, query]
  );
  const selectedCandidate =
    selection?.workspaceId === workspaceId
      ? (candidates.find((candidate) => candidate.canonicalPath === selection.path) ?? null)
      : null;

  const loadContent = useCallback(
    async (path: string, requestedWorkspace: string | null) => {
      const id = ++contentRequestId.current;
      setContent(null);
      setContentError(null);
      setContentLoading(true);
      try {
        const next = await api.readSkillContent({ path, workspaceId: requestedWorkspace });
        const currentSelection = selectionRef.current;
        if (
          id !== contentRequestId.current ||
          workspaceRef.current !== requestedWorkspace ||
          currentSelection?.workspaceId !== requestedWorkspace ||
          currentSelection.path !== path ||
          next.path !== path
        ) {
          return;
        }
        setContent(next);
      } catch (failure) {
        const currentSelection = selectionRef.current;
        if (
          id === contentRequestId.current &&
          workspaceRef.current === requestedWorkspace &&
          currentSelection?.workspaceId === requestedWorkspace &&
          currentSelection.path === path
        ) {
          setContentError(failure instanceof Error ? failure : new Error(String(failure)));
        }
      } finally {
        if (id === contentRequestId.current && workspaceRef.current === requestedWorkspace) {
          setContentLoading(false);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    contentRequestId.current += 1;
    setContent(null);
    setContentError(null);
    setContentLoading(false);
    toggleRequestId.current += 1;
    setTogglePath(null);
    setToggleFailed(false);
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedCandidate || selection?.workspaceId !== workspaceId) return;
    void loadContent(selectedCandidate.canonicalPath, workspaceId);
    return () => {
      contentRequestId.current += 1;
    };
  }, [loadContent, selectedCandidate, selection?.workspaceId, workspaceId]);

  useEffect(
    () => () => {
      contentRequestId.current += 1;
      toggleRequestId.current += 1;
    },
    []
  );

  async function toggle(candidate: SkillCandidate) {
    const id = ++toggleRequestId.current;
    const requestedWorkspace = workspaceId;
    const requestedPath = candidate.canonicalPath;
    toggleOperationRef.current = {
      requestId: id,
      workspaceId: requestedWorkspace,
      path: requestedPath
    };
    setTogglePath(requestedPath);
    setToggleFailed(false);
    const next = await catalog.setEnabled(requestedPath, !candidate.enabled);
    if (
      id !== toggleRequestId.current ||
      workspaceRef.current !== requestedWorkspace ||
      toggleOperationRef.current?.requestId !== id ||
      toggleOperationRef.current.workspaceId !== requestedWorkspace ||
      toggleOperationRef.current.path !== requestedPath
    ) {
      return;
    }
    setTogglePath(null);
    setToggleFailed(next === null);
  }

  function retryCatalog() {
    toggleRequestId.current += 1;
    toggleOperationRef.current = null;
    setTogglePath(null);
    setToggleFailed(false);
    void catalog.refresh();
  }

  const title = workspace?.name ?? t("settings.skillsGlobalTitle");
  const subtitle = workspace
    ? t("settings.skillsWorkspaceSubtitle")
    : t("settings.skillsGlobalSubtitle");

  return (
    <div className="min-w-0">
      <PaneHeader
        title={t("settings.skillsTitle")}
        subtitle={subtitle}
        action={
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-subtle">
                {t("settings.skillsContext")}
              </div>
              <div className="mt-1 truncate text-[13px] font-medium">{title}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 shrink-0 active:scale-95"
              onClick={retryCatalog}
              disabled={catalog.loading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", catalog.loading && "animate-spin")} />
              {t("settings.skillsRefresh")}
            </Button>
          </div>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section aria-label={t("settings.skillsCatalog")} className="min-w-0">
          <label className="relative block">
            <span className="sr-only">{t("settings.skillsSearch")}</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("settings.skillsSearch")}
              placeholder={t("settings.skillsSearchPlaceholder")}
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-[13px] text-text focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft"
            />
          </label>

          <div className="mt-3 overflow-hidden rounded-card border border-border bg-surface shadow-sm">
            {!catalog.snapshot && catalog.loading ? (
              <PaneStatus>{t("common.loading")}</PaneStatus>
            ) : !catalog.snapshot && catalog.error ? (
              <CatalogError onRetry={retryCatalog} message={t("settings.skillsRefreshFailed")} />
            ) : filteredCandidates.length === 0 ? (
              <PaneStatus>
                {query ? t("settings.skillsNoMatches") : t("settings.skillsEmpty")}
              </PaneStatus>
            ) : (
              filteredCandidates.map((candidate, index) => (
                <SkillRow
                  key={candidate.canonicalPath}
                  candidate={candidate}
                  selected={selectedCandidate?.canonicalPath === candidate.canonicalPath}
                  pending={togglePath === candidate.canonicalPath}
                  toggleDisabled={catalog.loading || togglePath !== null}
                  divider={index < filteredCandidates.length - 1}
                  onSelect={() => setSelection({ path: candidate.canonicalPath, workspaceId })}
                  onToggle={() => void toggle(candidate)}
                />
              ))
            )}
          </div>

          {catalog.snapshot && catalog.error && (
            <div className="mt-3">
              <CatalogError
                onRetry={retryCatalog}
                message={
                  toggleFailed
                    ? t("settings.skillsUpdateFailed")
                    : t("settings.skillsRefreshFailed")
                }
              />
            </div>
          )}
        </section>

        <section
          aria-label={t("settings.skillsDetails")}
          className="min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-sm"
        >
          {selectedCandidate ? (
            <SkillDetails
              candidate={selectedCandidate}
              content={content}
              loading={contentLoading}
              error={contentError}
              onRetry={() => void loadContent(selectedCandidate.canonicalPath, workspaceId)}
            />
          ) : (
            <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-10 text-center">
              <FileText className="h-5 w-5 text-text-faint" />
              <p className="mt-3 text-[13px] font-medium">{t("settings.skillsSelectTitle")}</p>
              <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-text-muted">
                {t("settings.skillsSelectDesc")}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SkillRow({
  candidate,
  selected,
  pending,
  toggleDisabled,
  divider,
  onSelect,
  onToggle
}: {
  candidate: SkillCandidate;
  selected: boolean;
  pending: boolean;
  toggleDisabled: boolean;
  divider: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const name = candidate.name ?? t("settings.skillsUnknown");
  const hasWarning = candidate.diagnostics.some((diagnostic) => diagnostic.level === "warning");
  return (
    <div
      data-testid={`skill-row-${candidate.canonicalPath}`}
      className={cn(
        "flex min-w-0 items-stretch gap-1 px-1.5",
        divider && "border-b border-border-soft",
        selected && "bg-brand-soft"
      )}
    >
      <button
        type="button"
        aria-label={`${t("settings.skillsViewDetails")}: ${name}`}
        onClick={onSelect}
        className="min-w-0 flex-1 rounded-md px-2.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-accent"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-text">
            {name}
          </span>
          <StatusBadge status={candidate.status} />
        </span>
        {candidate.description && (
          <span className="mt-1 block truncate text-[11.5px] text-text-muted">
            {candidate.description}
          </span>
        )}
        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[10.5px] text-text-subtle">
          <span>{t(SOURCE_KEYS[candidate.source])}</span>
          {hasWarning && <Badge tone="warning">{t("settings.skillsWarning")}</Badge>}
          {candidate.explicitOnly && <Badge tone="brand">{t("settings.skillsExplicitOnly")}</Badge>}
        </span>
        <span className="mono mt-1 block truncate text-[10px] text-text-faint">
          {candidate.discoveredPath}
        </span>
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={candidate.enabled}
        aria-busy={pending}
        aria-label={`${t("settings.skillsEnabled")}: ${name}`}
        disabled={toggleDisabled}
        onClick={onToggle}
        className="flex h-10 w-10 shrink-0 self-center items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={cn(
            "relative h-[21px] w-[38px] rounded-full",
            candidate.enabled ? "bg-brand" : "bg-border-strong"
          )}
        >
          <span
            className={cn(
              "absolute left-[1.5px] top-[1.5px] h-[18px] w-[18px] rounded-full bg-surface shadow-sm",
              candidate.enabled ? "translate-x-[17px]" : "translate-x-0"
            )}
          />
        </span>
      </button>
    </div>
  );
}

function SkillDetails({
  candidate,
  content,
  loading,
  error,
  onRetry
}: {
  candidate: SkillCandidate;
  content: SkillContent | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const name = candidate.name ?? t("settings.skillsUnknown");
  const hasWarning = candidate.diagnostics.some((diagnostic) => diagnostic.level === "warning");
  return (
    <div className="min-w-0">
      <div className="border-b border-border-soft px-4 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-all font-mono text-sm font-semibold">{name}</h2>
          <StatusBadge status={candidate.status} />
          {hasWarning && <Badge tone="warning">{t("settings.skillsWarning")}</Badge>}
          {candidate.explicitOnly && <Badge tone="brand">{t("settings.skillsExplicitOnly")}</Badge>}
        </div>
        {candidate.description && (
          <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">
            {candidate.description}
          </p>
        )}
      </div>

      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-border-soft px-4 py-4 text-[11.5px]">
        <Meta label={t("settings.skillsSource")} value={t(SOURCE_KEYS[candidate.source])} />
        <Meta label={t("settings.skillsDiscoveredPath")} value={candidate.discoveredPath} mono />
        <Meta label={t("settings.skillsCanonicalPath")} value={candidate.canonicalPath} mono />
      </dl>

      {candidate.diagnostics.length > 0 && (
        <div className="border-b border-border-soft px-4 py-4">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-subtle">
            {t("settings.skillsDiagnostics")}
          </h3>
          <ul className="mt-2 space-y-2">
            {candidate.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`} className="flex min-w-0 gap-2 text-xs">
                <AlertTriangle
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    diagnostic.level === "error" ? "text-danger" : "text-warn"
                  )}
                />
                <span className="min-w-0 break-words text-text-muted">{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-w-0 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-subtle">
            {t("settings.skillsPreview")}
          </h3>
          {content && (
            <span className="mono text-[10px] text-text-faint">
              {content.bytesTotal.toLocaleString()} {t("settings.skillsBytes")}
            </span>
          )}
        </div>
        {loading ? (
          <div className="mt-3 text-xs text-text-muted">{t("common.loading")}</div>
        ) : error ? (
          <div
            role="alert"
            className="mt-3 flex min-h-10 items-center justify-between gap-3 rounded-md bg-danger-soft px-3 text-xs text-danger"
          >
            <span>{t("settings.skillsContentFailed")}</span>
            <button
              type="button"
              className="h-10 shrink-0 rounded-md px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onRetry}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : content ? (
          <>
            {content.truncated && (
              <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-[11.5px] text-warn">
                {t("settings.skillsPreviewTruncated")}
              </p>
            )}
            <pre className="mono mt-3 max-h-[360px] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-code-bg p-3 text-[11px] leading-relaxed text-text">
              {content.content}
            </pre>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-text-subtle">{label}</dt>
      <dd className={cn("min-w-0 break-all text-text-muted", mono && "mono text-[10.5px]")}>
        {value}
      </dd>
    </>
  );
}

function StatusBadge({ status }: { status: SkillStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold",
        status === "effective" && "bg-ok-soft text-ok",
        status === "shadowed" && "bg-surface-3 text-text-muted",
        status === "disabled" && "bg-surface-3 text-text-subtle",
        status === "invalid" && "bg-danger-soft text-danger"
      )}
    >
      {t(STATUS_KEYS[status])}
    </span>
  );
}

function Badge({ children, tone }: { children: string; tone: "warning" | "brand" }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[9.5px] font-semibold",
        tone === "warning" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand-strong"
      )}
    >
      {children}
    </span>
  );
}

function PaneStatus({ children }: { children: string }) {
  return <div className="flex min-h-20 items-center px-4 text-xs text-text-muted">{children}</div>;
}

function CatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex min-h-12 items-center justify-between gap-3 rounded-md bg-danger-soft px-3 text-xs text-danger"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="h-10 shrink-0 rounded-md px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
