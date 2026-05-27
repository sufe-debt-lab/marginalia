import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import type { ApiClient } from "@/api/client.js";

export function BranchChip({ api, workspaceId }: { api: ApiClient; workspaceId: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.getBranch(workspaceId).then((b) => {
      if (active) setBranch(b);
    });
    return () => {
      active = false;
    };
  }, [api, workspaceId]);
  if (!branch) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
      <GitBranch className="h-3 w-3" />
      {branch}
    </span>
  );
}
