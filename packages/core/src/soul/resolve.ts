import { getGlobalSoulDir, getProfileSoulDir } from "./paths";
import { getSoulStatus, loadSoulStack, toSoulStatus } from "./load";
import type { LoadedSoulStack, SoulStatus } from "./types";

async function firstLoadedSoulStack(
  directories: string[],
): Promise<LoadedSoulStack | null> {
  for (const directory of directories) {
    const stack = await loadSoulStack(directory);

    if (stack.loaded.length > 0) {
      return stack;
    }
  }

  return null;
}

export async function resolveSoulStackForProfile(
  profileId: string,
): Promise<LoadedSoulStack | null> {
  return firstLoadedSoulStack([
    getProfileSoulDir(profileId),
    getGlobalSoulDir(),
  ]);
}

export async function resolveSoulStack(
  profileId?: string,
): Promise<LoadedSoulStack | null> {
  if (profileId) {
    return resolveSoulStackForProfile(profileId);
  }

  return firstLoadedSoulStack([getGlobalSoulDir()]);
}

export async function getResolvedSoulStatus(
  profileId?: string,
): Promise<SoulStatus> {
  const stack = profileId
    ? await resolveSoulStackForProfile(profileId)
    : await resolveSoulStack();

  if (!stack) {
    return getSoulStatus(getGlobalSoulDir());
  }

  return toSoulStatus(stack);
}
