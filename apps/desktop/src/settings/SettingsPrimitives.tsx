import type { ReactNode } from "react";
import { cn } from "@/lib/cn.js";

export function PaneHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end gap-4 border-b border-border-soft pb-4">
      <div className="flex-1">
        <h1 className="h-display text-[22px] font-medium tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-2.5 mt-6 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
      {children}
    </h2>
  );
}

export function SettingCard({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 overflow-hidden rounded-[10px] border border-border bg-surface">
      {children}
    </div>
  );
}

export function SettingRow({
  title,
  desc,
  control,
  last
}: {
  title: string;
  desc: ReactNode;
  control: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn("flex items-center gap-4 px-4 py-3.5", !last && "border-b border-border-soft")}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-text-muted">{desc}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full transition-colors",
        on ? "bg-foreground" : "bg-border-strong"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-all",
          on ? "left-4" : "left-0.5"
        )}
      />
    </button>
  );
}
