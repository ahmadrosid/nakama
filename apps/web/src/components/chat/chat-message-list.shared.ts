/** Whether message content is taller than its scroll viewport. */
export function listOverflowsViewport(
  listHeight: number,
  viewportHeight: number
): boolean {
  if (viewportHeight <= 0) {
    return false;
  }

  return listHeight > viewportHeight + 1;
}
