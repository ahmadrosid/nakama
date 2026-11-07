import type { DatabaseAdapter, StoredMcpServerRecord } from "@nakama/db";
import type { ManagedSecrets } from "./managed-secrets";

/** Config fields that carry credentials: OAuth grant, HTTP headers, stdio env. */
const SECRET_FIELDS = ["oauth", "headers", "env"] as const;

const SECRET_SCOPE = "mcp";

const MAX_SECRET_CHARS = 65_536;

/** Marks a stored config whose secret fields live in managed secrets. */
const SECRET_REF = "secretRef";

type Config = Record<string, unknown>;

function asConfig(config: unknown): Config | null {
  return config instanceof Object && !Array.isArray(config)
    ? (config as Config)
    : null;
}

/**
 * Keeps MCP credentials out of `mcp_servers.config`. Writes move the secret
 * fields into managed secrets (encrypted with NAKAMA_SECRETS_KEY, rotated and
 * checked with every other saved secret); reads put them back, so callers keep
 * seeing the full config. Without a secrets key the adapter is left as is.
 */
export async function installMcpSecretStore(
  db: DatabaseAdapter,
  secrets: Pick<ManagedSecrets, "delete" | "resolve" | "save">,
  hasKey = Boolean(process.env.NAKAMA_SECRETS_KEY)
): Promise<void> {
  if (!hasKey) {
    return;
  }

  const base = {
    delete: db.deleteMcpServer.bind(db),
    get: db.getMcpServer.bind(db),
    list: db.listMcpServers.bind(db),
    upsert: db.upsertMcpServer.bind(db),
  };

  const hydrate = async (
    record: StoredMcpServerRecord
  ): Promise<StoredMcpServerRecord> => {
    const config = asConfig(record.config);

    if (!config?.[SECRET_REF]) {
      return record;
    }

    const { [SECRET_REF]: _ref, ...rest } = config;
    let stored: Config = {};

    try {
      const { value } = await secrets.resolve(SECRET_SCOPE, record.id);
      stored = value ? (JSON.parse(value) as Config) : {};
    } catch {
      // A key that no longer decrypts leaves the server signed out, as a
      // restored backup does for provider keys.
    }

    return { ...record, config: { ...rest, ...stored } };
  };

  db.getMcpServer = async (id) => {
    const record = await base.get(id);

    return record ? hydrate(record) : null;
  };

  db.listMcpServers = async () =>
    Promise.all((await base.list()).map((record) => hydrate(record)));

  db.upsertMcpServer = async (record) => {
    const config = asConfig(record.config);

    if (!config) {
      await base.upsert(record);

      return;
    }

    const { [SECRET_REF]: _ref, ...plain } = config;
    const secret: Config = {};

    for (const field of SECRET_FIELDS) {
      if (plain[field] !== undefined) {
        secret[field] = plain[field];
        delete plain[field];
      }
    }

    if (Object.keys(secret).length === 0) {
      await secrets.delete(SECRET_SCOPE, record.id);
      await base.upsert({ ...record, config: plain });

      return;
    }

    // OAuth client registration plus JWT tokens can pass the 8 KiB default.
    await secrets.save(
      SECRET_SCOPE,
      record.id,
      JSON.stringify(secret),
      [],
      MAX_SECRET_CHARS
    );
    await base.upsert({ ...record, config: { ...plain, [SECRET_REF]: true } });
  };

  db.deleteMcpServer = async (id) => {
    const deleted = await base.delete(id);
    await secrets.delete(SECRET_SCOPE, id);

    return deleted;
  };

  // Rows written before this existed still hold plaintext. Rewriting them
  // through the wrapper moves the secrets out once.
  for (const record of await base.list()) {
    const config = asConfig(record.config);

    if (config && SECRET_FIELDS.some((field) => config[field] !== undefined)) {
      await db.upsertMcpServer(record);
    }
  }
}
