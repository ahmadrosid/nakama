import { chmod, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "@nakama/core/fs";
import {
  type AuthenticationState,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const PRIVATE_UMASK = 0o077;

interface PrivateMultiFileAuthState {
  saveCreds: () => Promise<void>;
  state: AuthenticationState;
}

export async function usePrivateMultiFileAuthState(
  directory: string
): Promise<PrivateMultiFileAuthState> {
  if (process.platform !== "win32") {
    // biome-ignore lint/suspicious/noBitwiseOperators: preserve stricter existing process restrictions.
    process.umask(process.umask() | PRIVATE_UMASK);
  }

  await mkdir(directory, { mode: PRIVATE_DIR_MODE, recursive: true });
  await chmod(directory, PRIVATE_DIR_MODE);

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      await chmod(join(directory, entry.name), PRIVATE_FILE_MODE);
    }
  }

  return useMultiFileAuthState(directory);
}
