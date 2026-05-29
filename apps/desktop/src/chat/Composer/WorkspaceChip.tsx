import { ChevronDown, Folder, Plus } from "lucide-react";
import type { Workspace } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu.js";
import { useTranslation } from "@/i18n/useTranslation.js";

interface Props {
  workspaces: readonly Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function WorkspaceChip({ workspaces, activeId, onSelect, onNew }: Props) {
  const { t } = useTranslation();
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 rounded-full text-xs font-normal">
          <Folder className="h-3 w-3" />
          {active ? active.name : t("common.selectWorkspace")}
          <ChevronDown className="h-3 w-3 text-text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => onSelect(w.id)}>
            <Folder className="mr-2 h-3 w-3" />
            {w.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew}>
          <Plus className="mr-2 h-3 w-3" />
          {t("common.newWorkspaceEllipsis")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
