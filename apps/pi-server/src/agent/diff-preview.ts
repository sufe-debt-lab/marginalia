import { createTwoFilesPatch } from "diff";

/** Diff the very bytes proposed for publication, after pi has computed an edit. */
export function previewContent(relativePath: string, before: string, after: string) {
  const patch = createTwoFilesPatch(relativePath, relativePath, before, after, "", "", {
    context: 3
  });
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { patch, additions, deletions, exact: true };
}
