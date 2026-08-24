import { chmod, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "@nakama/core/fs";
import {
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

interface PrivateMultiFileAuthState {
  saveCreds: () => Promise<void>;
  state: AuthenticationState;
}

async function settleOperations(
  operations: Promise<unknown>[],
  message: string
): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, message);
  }
}

async function hardenAuthDirectory(directory: string): Promise<void> {
  await chmod(directory, PRIVATE_DIR_MODE);
  const entries = await readdir(directory, { withFileTypes: true });

  await settleOperations(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => chmod(join(directory, entry.name), PRIVATE_FILE_MODE)),
    "Could not secure every WhatsApp auth file"
  );
}

async function runHardenedMutation(
  directory: string,
  operation: () => Promise<void>
): Promise<void> {
  const failures: unknown[] = [];

  try {
    await hardenAuthDirectory(directory);
    await operation();
  } catch (error) {
    failures.push(error);
  }

  try {
    await hardenAuthDirectory(directory);
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "WhatsApp auth persistence and permission hardening failed"
    );
  }
}

async function setKeysAndWait(
  setKeys: SignalKeyStore["set"],
  data: SignalDataSet
): Promise<void> {
  const operations: Promise<void>[] = [];
  const categories = Object.keys(data) as (keyof SignalDataTypeMap)[];

  for (const category of categories) {
    const values = data[category];
    if (!values) {
      continue;
    }

    for (const id of Object.keys(values)) {
      const singleKey = {
        [category]: { [id]: values[id] },
      } as SignalDataSet;
      operations.push(Promise.resolve().then(() => setKeys(singleKey)));
    }
  }

  await settleOperations(
    operations,
    "Multiple WhatsApp auth key writes failed"
  );
}

export async function usePrivateMultiFileAuthState(
  directory: string
): Promise<PrivateMultiFileAuthState> {
  await mkdir(directory, { mode: PRIVATE_DIR_MODE, recursive: true });
  await hardenAuthDirectory(directory);
  const auth = await useMultiFileAuthState(directory);
  await hardenAuthDirectory(directory);

  let mutationQueue = Promise.resolve();
  const persist = (operation: () => Promise<void>): Promise<void> => {
    const result = mutationQueue.then(() =>
      runHardenedMutation(directory, operation)
    );
    mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  return {
    saveCreds: () => persist(() => auth.saveCreds()),
    state: {
      ...auth.state,
      keys: {
        get: (...args) => auth.state.keys.get(...args),
        set: (data) =>
          persist(() =>
            setKeysAndWait((entry) => auth.state.keys.set(entry), data)
          ),
      },
    },
  };
}
