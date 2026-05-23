import { join } from "node:path";
import { getUserConfigDir } from "../user-config";

/** Global soul stack: ~/.tinyclaw/SOUL.md, STYLE.md, etc. */
export function getGlobalSoulDir(): string {
  return getUserConfigDir();
}

/** Per-profile soul override: ~/.tinyclaw/profiles/{profileId}/ */
export function getProfileSoulDir(profileId: string): string {
  return join(getUserConfigDir(), "profiles", profileId);
}
