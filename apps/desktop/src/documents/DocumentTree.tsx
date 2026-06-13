import { FileTree, useFileTree } from "@pierre/trees/react";
import { useCallback, useMemo } from "react";
import { useTranslation } from "@/i18n/useTranslation.js";

interface Props {
  paths: readonly string[];
  onSelect: (path: string) => void;
  selectedPath?: string | null;
}

/**
 * Thin wrapper around `@pierre/trees`'s React entry. We expose a simple
 * `paths + onSelect` surface because most callers only care about the active
 * file. Multi-select is collapsed to the last selected path.
 */
export function DocumentTree({ paths, onSelect, selectedPath }: Props) {
  const { t } = useTranslation();
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const last = selectedPaths[selectedPaths.length - 1];
      if (last) onSelect(last);
    },
    [onSelect]
  );

  const initialSelectedPaths = useMemo(() => (selectedPath ? [selectedPath] : []), [selectedPath]);

  // useFileTree must be called unconditionally; supply empty paths when none.
  const { model } = useFileTree({
    paths,
    initialSelectedPaths,
    onSelectionChange: handleSelectionChange
  });

  const treeStyle =
    paths.length > 0
      ? ({
          // The library re-declares the base vars on its own container as
          // `var(--*-override, default)`, so the public extension point is the
          // `-override` variables.
          "--trees-accent-override": "var(--brand)",
          "--trees-selected-bg-override": "color-mix(in lab, var(--brand) 12%, var(--surface))",
          "--trees-selected-focused-border-color-override": "var(--brand)"
        } as React.CSSProperties)
      : undefined;

  return (
    <div data-pierre-tree-host className="h-full shrink-0 overflow-auto" style={treeStyle}>
      {paths.length === 0 ? (
        <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
          {t("docPanel.noFiles")}
        </div>
      ) : (
        <FileTree model={model} />
      )}
    </div>
  );
}
