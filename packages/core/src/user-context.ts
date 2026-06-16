import { join } from "node:path";
import {
  ensureDir,
  readTextIfExists,
  writePrivateTextFile,
  writePrivateTextFileIfMissing,
} from "./fs";
import { getUserConfigDir } from "./user-config";

const USER_TEMPLATE = `# About Me

- Name / nickname:
- What you do:
- Current projects:
- Tech stack:
- How you like replies (concise, detailed, casual, formal):
- Always:
- Never:
`;

export function getUserContextPath(): string {
  return join(getUserConfigDir(), "USER.md");
}

export async function loadUserContext(): Promise<string | undefined> {
  return readTextIfExists(getUserContextPath());
}

export async function getUserContextStatus(): Promise<{
  path: string;
  active: boolean;
  content?: string;
}> {
  const path = getUserContextPath();
  const content = await loadUserContext();

  return {
    path,
    active: content !== undefined,
    ...(content !== undefined ? { content } : {}),
  };
}

export async function writeUserContext(content: string): Promise<void> {
  await writePrivateTextFile(getUserContextPath(), content, {
    ensureDir: getUserConfigDir(),
  });
}

export interface InitUserContextResult {
  path: string;
  created: boolean;
}

export async function initUserContext(): Promise<InitUserContextResult> {
  const path = getUserContextPath();
  await ensureDir(getUserConfigDir());
  const created = await writePrivateTextFileIfMissing(path, USER_TEMPLATE);
  return { path, created };
}
