export function followOutputBehavior(atBottom: boolean): false | "auto" {
  return atBottom ? "auto" : false;
}

export function shouldAutoscrollOnHeightGrowth(atBottom: boolean): boolean {
  return atBottom;
}

/**
 * Whether list content is taller than the scroll viewport.
 * If the viewport size is unknown (0), treat as not overflowing so short
 * threads are not incorrectly pinned with scrollToIndex(align: "end").
 */
export function listOverflowsViewport(
  listHeight: number,
  viewportHeight: number,
): boolean {
  if (viewportHeight <= 0) return false;
  return listHeight > viewportHeight + 1;
}
