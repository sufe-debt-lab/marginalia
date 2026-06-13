import { Pin, PinOff, Trash2 } from "lucide-react";
import type { Workspace } from "@/api/client.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu.js";
import { useTranslation } from "@/i18n/useTranslation.js";

interface Props {
  workspace: Workspace;
  pinned: boolean;
  onPin: (id: string) => void;
  onDelete: (workspace: Workspace) => void;
  children: React.ReactNode;
}

export function WorkspaceActions({ workspace, pinned, onPin, onDelete, children }: Props) {
  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => onPin(workspace.id)}>
          {pinned ? <PinOff className="mr-2 h-3.5 w-3.5" /> : <Pin className="mr-2 h-3.5 w-3.5" />}
          {pinned ? t("common.unpin") : t("common.pin")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => onDelete(workspace)}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {t("common.delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
