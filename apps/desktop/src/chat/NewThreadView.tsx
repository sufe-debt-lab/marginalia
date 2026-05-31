import { toast } from "sonner";
import type { ApiClient } from "@/api/client.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { Composer } from "./Composer/Composer.js";
import { WorkspaceChip } from "./Composer/WorkspaceChip.js";
import { RecentThreads } from "./RecentThreads.js";

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "workspace";
}

export function NewThreadView({ api }: { api: ApiClient }) {
  const { t } = useTranslation();
  const workspaces = useWorkspaces(api);
  const providers = useProviders(api);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveSessionTitle = useAppStore((s) => s.setActiveSessionTitle);
  const setPendingPrompt = useAppStore((s) => s.setPendingPrompt);
  const setView = useAppStore((s) => s.setView);
  const contextFiles = useAppStore((s) => s.contextFiles);
  const addContext = useAppStore((s) => s.addContextFile);
  const removeContext = useAppStore((s) => s.removeContextFile);
  const composerProviderId = useAppStore((s) => s.composerProviderId);
  const composerModel = useAppStore((s) => s.composerModel);
  const setComposerModel = useAppStore((s) => s.setComposerModel);
  const permission = useAppStore((s) => s.permission);
  const reasoning = useAppStore((s) => s.reasoning);
  const setPermission = useAppStore((s) => s.setPermission);
  const setReasoning = useAppStore((s) => s.setReasoning);

  const firstProvider = providers.data[0];
  const actualProviderId = composerProviderId || firstProvider?.id || "";
  const actualModel = composerModel || firstProvider?.defaultModel || "";

  async function pickNewWorkspace() {
    const picked = await window.marginalia?.pickWorkspaceDirectory?.();
    if (!picked) return;
    try {
      const created = await workspaces.create({ name: basename(picked), rootDir: picked });
      setActiveWorkspace(created.id);
      toast.success(`${t("toast.workspaceCreated")}: ${created.name}`);
    } catch (err) {
      toast.error(`${t("toast.createWorkspaceFailed")}: ${(err as Error).message}`);
    }
  }

  async function submit(text: string) {
    if (!activeWorkspaceId) return;
    try {
      const session = await api.createSession({
        workspaceId: activeWorkspaceId,
        title: text.slice(0, 32)
      });
      setActiveSession(session.id);
      setActiveSessionTitle(session.title);
      setPendingPrompt(text);
      setView("chat");
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  const canSend = Boolean(activeWorkspaceId);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[660px] flex-1 flex-col justify-center px-4 py-12">
        <h1 className="h-display mb-8 text-center text-[30px] font-normal tracking-tight">
          {t("newThread.title")}
        </h1>
        <Composer
          api={api}
          workspaceId={activeWorkspaceId}
          providers={providers.data}
          providerId={actualProviderId}
          model={actualModel}
          onModelChange={({ providerId: p, model: m }) => setComposerModel(p, m)}
          contextFiles={contextFiles}
          onAddContextFile={addContext}
          onRemoveContextFile={removeContext}
          permission={permission}
          reasoning={reasoning}
          onPermissionChange={setPermission}
          onReasoningChange={setReasoning}
          sending={false}
          disabled={!canSend}
          onSubmit={submit}
          placeholder={t("newThread.placeholder")}
          autoFocus
        />
        <div className="mt-3.5 flex flex-wrap items-center justify-start gap-2">
          <WorkspaceChip
            workspaces={workspaces.data}
            activeId={activeWorkspaceId}
            onSelect={setActiveWorkspace}
            onNew={pickNewWorkspace}
          />
        </div>
        <RecentThreads api={api} />
      </div>
    </div>
  );
}
