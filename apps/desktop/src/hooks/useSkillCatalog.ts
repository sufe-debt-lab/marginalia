import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ApiError, SkillCandidate, SkillCatalogSnapshot } from "@/api/client.js";

export type SkillPickerItem = Omit<
  Pick<
    SkillCandidate,
    "name" | "description" | "canonicalPath" | "source" | "explicitOnly" | "diagnostics"
  >,
  "name"
> & { name: string };

function asError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

export function useSkillCatalog(
  api: ApiClient,
  workspaceId: string | null
): {
  snapshot: SkillCatalogSnapshot | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh(): Promise<SkillCatalogSnapshot | null>;
  setEnabled(path: string, enabled: boolean): Promise<SkillCatalogSnapshot | null>;
} {
  const [snapshot, setSnapshot] = useState<SkillCatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [stateWorkspaceId, setStateWorkspaceId] = useState(workspaceId);
  const requestId = useRef(0);
  const mutationRef = useRef<{
    requestId: number;
    workspaceId: string | null;
    path: string;
  } | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const requestedWorkspace = workspaceId;
    setStateWorkspaceId(requestedWorkspace);
    setLoading(true);
    try {
      const next = await api.listSkills(requestedWorkspace);
      if (id !== requestId.current || workspaceRef.current !== requestedWorkspace) return null;
      if (next.workspaceId !== requestedWorkspace) {
        setError(new Error("Skill catalog response workspace mismatch"));
        return null;
      }
      setSnapshot(next);
      setError(null);
      return next;
    } catch (failure) {
      if (id === requestId.current && workspaceRef.current === requestedWorkspace) {
        setError(asError(failure));
      }
      return null;
    } finally {
      if (id === requestId.current && workspaceRef.current === requestedWorkspace) {
        setLoading(false);
      }
    }
  }, [api, workspaceId]);

  const setEnabled = useCallback(
    async (path: string, enabled: boolean) => {
      const id = ++requestId.current;
      const requestedWorkspace = workspaceId;
      const requestedPath = path;
      mutationRef.current = { requestId: id, workspaceId: requestedWorkspace, path: requestedPath };
      const isCurrentMutation = () => {
        const mutation = mutationRef.current;
        return (
          id === requestId.current &&
          workspaceRef.current === requestedWorkspace &&
          mutation?.requestId === id &&
          mutation.workspaceId === requestedWorkspace &&
          mutation.path === requestedPath
        );
      };
      setStateWorkspaceId(requestedWorkspace);
      setLoading(true);
      try {
        const next = await api.setSkillEnabled({
          path: requestedPath,
          enabled,
          workspaceId: requestedWorkspace
        });
        if (!isCurrentMutation()) return null;
        if (next.workspaceId !== requestedWorkspace) {
          setError(new Error("Skill catalog response workspace mismatch"));
          return null;
        }
        setSnapshot(next);
        setError(null);
        return next;
      } catch (failure) {
        if (isCurrentMutation()) {
          setError(asError(failure));
        }
        return null;
      } finally {
        if (isCurrentMutation()) {
          setLoading(false);
        }
      }
    },
    [api, workspaceId]
  );

  useEffect(() => {
    requestId.current += 1;
    setStateWorkspaceId(workspaceId);
    setSnapshot(null);
    setError(null);
    setLoading(true);
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh, workspaceId]);

  if (stateWorkspaceId !== workspaceId) {
    return { snapshot: null, loading: true, error: null, refresh, setEnabled };
  }
  return { snapshot, loading, error, refresh, setEnabled };
}
