import { toast } from "sonner";
import { useEffect, useRef } from "react";
import type { ApiClient } from "@/api/client.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useSkillCatalog } from "@/hooks/useSkillCatalog.js";
import { resolveComposerSelection } from "@/lib/provider-selection.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore, type TurnDraft, type TurnOwner } from "@/store/app-store.js";
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
  const owner: TurnOwner = `new:${activeWorkspaceId ?? "global"}`;
  const draft = useAppStore((s) => s.turnDrafts[owner]);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveSessionTitle = useAppStore((s) => s.setActiveSessionTitle);
  const setTurnText = useAppStore((s) => s.setTurnText);
  const addTurnContextFile = useAppStore((s) => s.addTurnContextFile);
  const removeTurnContextFile = useAppStore((s) => s.removeTurnContextFile);
  const addTurnSkill = useAppStore((s) => s.addTurnSkill);
  const removeTurnSkill = useAppStore((s) => s.removeTurnSkill);
  const moveTurnDraft = useAppStore((s) => s.moveTurnDraft);
  const setPendingTurn = useAppStore((s) => s.setPendingTurn);
  const setView = useAppStore((s) => s.setView);
  const composerProviderId = useAppStore((s) => s.composerProviderId);
  const composerModel = useAppStore((s) => s.composerModel);
  const setComposerModel = useAppStore((s) => s.setComposerModel);
  const permission = useAppStore((s) => s.permission);
  const reasoning = useAppStore((s) => s.reasoning);
  const setPermission = useAppStore((s) => s.setPermission);
  const setReasoning = useAppStore((s) => s.setReasoning);
  const submittingRef = useRef(false);
  const submissionGenerationRef = useRef(0);
  const skillCatalog = useSkillCatalog(api, activeWorkspaceId);

  useEffect(
    () => () => {
      submissionGenerationRef.current += 1;
    },
    []
  );

  const enabledProviders = providers.enabled;
  // Honour the stored selection only while it's still enabled; otherwise fall back
  // so a disabled/deleted provider id is never sent to the run endpoint.
  const { providerId: actualProviderId, model: actualModel } = resolveComposerSelection(
    enabledProviders,
    composerProviderId,
    composerModel
  );

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

  async function submit(turn: TurnDraft) {
    if (!activeWorkspaceId || submittingRef.current) return;
    const submittedWorkspaceId = activeWorkspaceId;
    const submittedOwner = owner;
    const generation = ++submissionGenerationRef.current;
    submittingRef.current = true;
    try {
      const session = await api.createSession({
        workspaceId: submittedWorkspaceId,
        title: turn.text.slice(0, 32)
      });
      if (generation !== submissionGenerationRef.current) return;
      const moved = moveTurnDraft(submittedOwner, `session:${session.id}`, turn);
      setPendingTurn({ sessionId: session.id, turn: moved });
      setActiveWorkspace(submittedWorkspaceId);
      setActiveSession(session.id);
      setActiveSessionTitle(session.title);
      setView("chat");
    } catch (err) {
      if (generation === submissionGenerationRef.current) {
        toast.error(`${t("newThread.createSessionFailed")}: ${(err as Error).message}`);
      }
    } finally {
      if (generation === submissionGenerationRef.current) submittingRef.current = false;
    }
  }

  const canSend = Boolean(activeWorkspaceId);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto w-full max-w-[640px] px-6 pb-12 pt-[clamp(52px,16vh,112px)]">
        <h1 className="h-display mb-[26px] text-balance text-center text-[34px] font-medium leading-[1.18] tracking-[-0.025em]">
          {t("newThread.title")}
        </h1>
        <Composer
          api={api}
          workspaceId={activeWorkspaceId}
          skillCatalog={skillCatalog}
          providers={enabledProviders}
          providerId={actualProviderId}
          model={actualModel}
          onModelChange={({ providerId: p, model: m }) => setComposerModel(p, m)}
          text={draft?.text ?? ""}
          onTextChange={(text) => setTurnText(owner, text)}
          contextFiles={draft?.contextFiles ?? []}
          onAddContextFile={(path) => addTurnContextFile(owner, path)}
          onRemoveContextFile={(path) => removeTurnContextFile(owner, path)}
          skills={draft?.skills ?? []}
          onAddSkill={(skill) => addTurnSkill(owner, skill)}
          onRemoveSkill={(path) => removeTurnSkill(owner, path)}
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
