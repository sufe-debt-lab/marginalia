import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { cn } from "@/lib/cn.js";

interface Props {
  providers: readonly Provider[];
  providerId: string;
  model: string;
  onChange: (next: { providerId: string; model: string }) => void;
}

export function ModelPicker({ providers, providerId, model, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = providers.find((p) => p.id === providerId);
  const label = active ? `${active.name} · ${model || active.defaultModel}` : "Select model";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs font-normal">
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {providers.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">No providers configured</p>
        )}
        {providers.map((p) => (
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
            {p.id === providerId && <Check className="h-3 w-3" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
