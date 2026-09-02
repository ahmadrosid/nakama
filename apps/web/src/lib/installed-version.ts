/** Label for the installed Nakama version shown in Settings / account UI. */
export function installedVersionLabel(
  version: string | null | undefined
): string | null {
  const trimmed = version?.trim();
  return trimmed ? trimmed : null;
}
