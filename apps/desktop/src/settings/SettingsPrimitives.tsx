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
    <div className="mb-6">
      <div>
        <h1 className="h-display text-2xl font-medium tracking-[-0.018em]">{title}</h1>
        <p className="mt-1 text-[13.5px] text-text-muted">{subtitle}</p>
      </div>
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

export function SectionLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h2
      className={cn(
        "mb-2.5 mt-[22px] text-[10px] font-bold uppercase tracking-[0.08em] text-text-subtle",
        className
      )}
    >
      {children}
    </h2>
  );
}

/** Section wrapper; `card` adds the locked card chrome (13px radius, border, surface). */
export function SettingCard({
  card,
  className,
  children
}: {
  card?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-5",
        card && "overflow-hidden rounded-card border border-border bg-surface",
        className
      )}
    >
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
    <div className={cn("flex items-center gap-4 py-4", !last && "border-b border-border-soft")}>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-text-muted">{desc}</div>
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
        "relative h-[21px] w-[38px] shrink-0 rounded-full transition-colors motion-standard",
        on ? "bg-foreground" : "bg-border-strong"
      )}
    >
      <span
        className={cn(
          "absolute left-[1.5px] top-[1.5px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform motion-standard",
          on ? "translate-x-[17px]" : "translate-x-0"
        )}
      />
    </button>
  );
}
