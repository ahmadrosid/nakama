export function canArchiveOrganization(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin;
}

export function nextOrgIdAfterArchive(
  orgs: Array<{ id: string }>,
  archivedOrgId: string
): string | null {
  return orgs.find((org) => org.id !== archivedOrgId)?.id ?? null;
}
