import { ChevronDown, Eye, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu.js";
import { useTranslation } from "@/i18n/useTranslation.js";

export type Permission = "full" | "ask" | "readonly";

interface Props {
  value: Permission;
  onChange: (p: Permission) => void;
}

export function PermissionChip({ value, onChange }: Props) {
  const { t } = useTranslation();
  const conf: Record<Permission, { icon: typeof Eye; label: string; className: string }> = {
    full: {
      icon: ShieldAlert,
      label: t("composer.permFull"),
      className: "text-[oklch(0.58_0.17_35)]"
    },
    ask: {
      icon: ShieldQuestion,
      label: t("composer.permAsk"),
      className: "text-[oklch(0.55_0.15_80)]"
    },
    readonly: { icon: Eye, label: t("composer.permReadonly"), className: "text-text-muted" }
  };
  const Active = conf[value].icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("composer.permission")}
          className={`gap-1.5 text-xs font-medium ${conf[value].className}`}
        >
          <Active className="h-3.5 w-3.5" />
          {conf[value].label}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        {(Object.keys(conf) as Permission[]).map((p) => {
          const Icon = conf[p].icon;
          return (
            <DropdownMenuItem key={p} onSelect={() => onChange(p)}>
              <Icon className="mr-2 h-3.5 w-3.5" />
              {conf[p].label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
