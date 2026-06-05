import { brandColorFor } from "./provider-catalog.js";

export function ProviderAvatar({ name, size = 30 }: { name: string; size?: number }) {
  const color = brandColorFor(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] font-mono font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        ...(color
          ? { background: color, color: "#fff" }
          : { background: "var(--surface-3)", color: "var(--text-muted)" })
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
