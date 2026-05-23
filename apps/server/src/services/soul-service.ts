import {
  composeSoulSystemPrompt,
  getGlobalSoulDir,
  getProfileSoulDir,
  getResolvedSoulStatus,
  initSoulDirectory,
  isWritableSoulFileKey,
  loadSoulStack,
  resolveSoulStack,
  resolveSoulStackForProfile,
  writeSoulFile,
  type InitSoulResult,
  type SoulStatus,
} from "@tinyclaw/core";

export class SoulService {
  async getGlobalSoulStatus(): Promise<SoulStatus> {
    return getResolvedSoulStatus();
  }

  async getProfileSoulStatus(profileId: string): Promise<SoulStatus> {
    return getResolvedSoulStatus(profileId);
  }

  async getGlobalSoulStack() {
    return loadSoulStack(getGlobalSoulDir());
  }

  async getProfileSoulStack(profileId: string) {
    return loadSoulStack(getProfileSoulDir(profileId));
  }

  async writeGlobalSoulFile(key: string, content: string): Promise<void> {
    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    await writeSoulFile(getGlobalSoulDir(), key, content);
  }

  async writeProfileSoulFile(profileId: string, key: string, content: string): Promise<void> {
    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    await writeSoulFile(getProfileSoulDir(profileId), key, content);
  }

  async initGlobalSoul(): Promise<InitSoulResult> {
    return initSoulDirectory(getGlobalSoulDir());
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResult> {
    return initSoulDirectory(getProfileSoulDir(profileId));
  }

  async resolveSystemPrompt(
    profileId: string,
    profilePrompt: string,
  ): Promise<string> {
    const stack = await resolveSoulStackForProfile(profileId);

    if (!stack) {
      return profilePrompt;
    }

    return composeSoulSystemPrompt(stack, { profilePrompt });
  }

  async isSoulActive(profileId: string): Promise<boolean> {
    const stack = await resolveSoulStackForProfile(profileId);
    return stack !== null;
  }

  async resolveSoulStack(profileId?: string) {
    return resolveSoulStack(profileId);
  }
}

export {
  composeSoulSystemPrompt,
  getGlobalSoulDir,
  getProfileSoulDir,
  resolveSoulStackForProfile,
};
