/** Profile override wins when non-null; otherwise org default (false when unset). */
export function resolveProfileOrgBooleanOverride(
  profileValue: boolean | null | undefined,
  orgValue: boolean | null | undefined
): boolean {
  if (profileValue !== undefined && profileValue !== null) {
    return profileValue;
  }
  return orgValue === true;
}
