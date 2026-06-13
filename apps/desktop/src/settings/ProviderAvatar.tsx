/**
 * Neutral provider tile — light grey with an ink initial. The locked
 * mono + emerald system deliberately avoids brand colours here so the
 * emerald status accents stay the only colour on the page.
 */
export function ProviderAvatar({ name, size = 34 }: { name: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center border border-border bg-surface-3 font-mono font-semibold text-text"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        borderRadius: Math.round(size * 0.24)
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
