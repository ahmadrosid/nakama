import { join } from "node:path";
import { getProfileSoulDir } from "./resolve";

export const MEMORY_ARCHIVE_RELATIVE_DIR = "memory-archive";

export function getMemoryArchiveDir(orgId: string, profileId: string): string {
  return join(getProfileSoulDir(orgId, profileId), MEMORY_ARCHIVE_RELATIVE_DIR);
}

export function getMemoryArchiveFilePath(
  orgId: string,
  profileId: string,
  yearMonth: string,
): string {
  return join(getMemoryArchiveDir(orgId, profileId), `${yearMonth}.md`);
}

export function formatMemoryArchiveYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
