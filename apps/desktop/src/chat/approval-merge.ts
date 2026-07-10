import type { Approval } from "@/api/client.js";

/**
 * Merge the persisted approvals fetched on session open with entries that
 * streamed in while the fetch was in flight. Live entries win: anything the
 * stream delivered (a fresh pending card, or a resolution) is at least as new
 * as the fetch snapshot, so a wholesale replace must never drop it.
 */
export function mergeApprovals(
  fetched: readonly Approval[],
  live: ReadonlyMap<string, Approval>
): Map<string, Approval> {
  const merged = new Map(fetched.map((approval) => [approval.toolCallId, approval]));
  for (const [toolCallId, approval] of live) merged.set(toolCallId, approval);
  return merged;
}
