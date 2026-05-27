import { FileTree, useFileTree } from "@pierre/trees/react";
import { useCallback, useMemo } from "react";

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
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      const last = selectedPaths[selectedPaths.length - 1];
      if (last) onSelect(last);
    },
    [onSelect]
  );

  const initialSelectedPaths = useMemo(
    () => (selectedPath ? [selectedPath] : []),
    [selectedPath]
  );

  // useFileTree must be called unconditionally; supply empty paths when none.
  const { model } = useFileTree({
    paths,
    initialSelectedPaths,
    onSelectionChange: handleSelectionChange
  });

  if (paths.length === 0) {
    return (
      <div
        data-pierre-tree-host
        className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground"
      >
        No files
      </div>
    );
  }

  return (
    <div data-pierre-tree-host className="h-full overflow-auto">
      <FileTree model={model} />
    </div>
  );
}
