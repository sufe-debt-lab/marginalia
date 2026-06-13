import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";

export type Reasoning = "low" | "medium" | "high" | "xhigh";

interface Props {
  providers: readonly Provider[];
  providerId: string;
  model: string;
  onChange: (next: { providerId: string; model: string }) => void;
  reasoning?: Reasoning;
  onReasoningChange?: (r: Reasoning) => void;
}

export function ModelPicker({
  providers,
  providerId,
  model,
  onChange,
  reasoning,
  onReasoningChange
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const active = providers.find((p) => p.id === providerId);
  const reasoningLabels: Record<Reasoning, string> = {
    low: t("composer.reasoningLow"),
    medium: t("composer.reasoningMedium"),
    high: t("composer.reasoningHigh"),
    xhigh: t("composer.reasoningExtraHigh")
  };
  const base = active
    ? `${active.name} · ${model || active.defaultModel}`
    : t("composer.selectModel");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs font-normal">
          {reasoning ? (
            <>
              <span className="text-text-subtle">{base} ·</span>
              <span className="font-medium">{reasoningLabels[reasoning]}</span>
            </>
          ) : (
            base
          )}
          <ChevronDown className="h-3 w-3 text-text-muted" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={8}
        className="flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-56 flex-col p-1"
      >
        {reasoning && onReasoningChange && (
          <div className="shrink-0">
            <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
              {t("composer.reasoning")}
            </div>
            {(Object.keys(reasoningLabels) as Reasoning[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onReasoningChange(r)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              >
                <span>{reasoningLabels[r]}</span>
                {r === reasoning && <Check className="h-3 w-3 text-brand" />}
              </button>
            ))}
            {providers.length !== 1 && <div className="my-1 border-t border-border-soft" />}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {providers.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">{t("settings.noProviders")}</p>
          )}
          {providers.length > 1 &&
            providers.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange({ providerId: p.id, model: p.defaultModel });
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
                  p.id === providerId && "bg-accent"
                )}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.defaultModel}</span>
                </span>
                {p.id === providerId && <Check className="h-3 w-3 text-brand" />}
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
