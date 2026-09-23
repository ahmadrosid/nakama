import { Database } from "bun:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity, type PeerCertificate } from "node:tls";
import type { PluginExecutionContext } from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import postgres from "postgres";
import { z } from "zod";

// This capability is intentionally PostgreSQL-specific. Approved plugins remain
// trusted OS code; this is not a sandbox against malicious installed packages.
const identifier = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const ids = z.array(z.string().min(1).max(200)).max(100);
const configuration = z
  .object({
    ca: z.string().max(32_768).default(""),
    database: z.string().min(1).max(63),
    disclosureAccepted: z.literal(true),
    host: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9][a-z0-9.-]*$/),
    name: z.string().trim().min(1).max(100),
    port: z.number().int().min(1).max(65_535),
    profileIds: ids,
    relations: z
      .array(z.object({ schema: identifier, table: identifier }).strict())
      .min(1)
      .max(50),
    userIds: ids,
    username: z.string().min(1).max(63),
  })
  .strict();
type Configuration = z.infer<typeof configuration>;
type Connection = {
  id: string;
  revision: number;
  config: string;
  secret: string;
};
const request = z
  .object({
    agentId: z.string().min(1).max(200).optional(),
    columns: z.array(identifier).min(1).max(40).optional(),
    connectionId: z.string().uuid(),
    descending: z.boolean().default(false),
    filters: z
      .array(
        z
          .object({
            column: identifier,
            value: z.union([
              z.string().max(4096),
              z.number().finite(),
              z.boolean(),
              z.null(),
            ]),
          })
          .strict()
      )
      .max(10)
      .default([]),
    limit: z.number().int().min(1).max(200).default(200),
    orderBy: identifier.optional(),
    schema: identifier.optional(),
    table: identifier.optional(),
  })
  .strict();
const denied = () => new Error("PostgreSQL access denied");

function keyring() {
  try {
    const keys = z
      .record(z.string(), z.string())
      .parse(JSON.parse(process.env.NAKAMA_POSTGRES_KEYS ?? "{}"));
    const active = process.env.NAKAMA_POSTGRES_KEY_ID ?? "";
    if (!(active && keys[active])) {
      throw new Error("Missing active encryption key");
    }
    const decoded = Object.fromEntries(
      Object.entries(keys).map(([id, key]) => {
        const bytes = Buffer.from(key, "base64");
        if (bytes.length !== 32 || bytes.toString("base64") !== key) {
          throw new Error("Invalid encryption key");
        }
        return [id, bytes];
      })
    );
    return { active, keys: decoded };
  } catch {
    throw new Error("PostgreSQL encryption key unavailable");
  }
}

export function sealPostgresPassword(password: string, scope: string): string {
  const { active, keys } = keyring();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys[active]!, nonce);
  cipher.setAAD(Buffer.from(scope));
  const ciphertext = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    key: active,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  });
}

export function openPostgresPassword(secret: string, scope: string): string {
  try {
    const envelope = JSON.parse(secret);
    const key = keyring().keys[envelope.key];
    if (!key) {
      throw new Error("Missing decryption key");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.nonce, "base64")
    );
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "PostgreSQL credential unavailable; check encryption keys or replace credential"
    );
  }
}

const prohibited = new BlockList();
for (const [ip, bits] of [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  prohibited.addSubnet(ip, bits, "ipv4");
}
// v1 deliberately supports IPv4 only, including operator-approved private IPs.
const policySchema = z.array(
  z
    .object({
      addresses: z.array(z.string()).min(1),
      host: z.string(),
      port: z.number().int(),
    })
    .strict()
);

export async function resolvePostgresAddress(
  host: string,
  port: number,
  resolver: {
    resolve4(host: string): Promise<string[]>;
    cancel(): void;
  } = new Resolver({
    timeout: 2000,
    tries: 1,
  }),
  parentSignal?: AbortSignal
): Promise<string> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(3000),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  const abort = () => resolver.cancel();
  signal.addEventListener("abort", abort, { once: true });
  let addresses: string[];
  try {
    signal.throwIfAborted();
    const policy = policySchema.parse(
      JSON.parse(process.env.NAKAMA_POSTGRES_NETWORK_POLICY ?? "[]")
    );
    const rule = policy.find(
      (item) => item.host === host && item.port === port
    );
    if (!rule) {
      throw new Error("Missing network rule");
    }
    addresses = isIP(host) ? [host] : await resolver.resolve4(host);
    signal.throwIfAborted();
    if (
      !addresses.length ||
      addresses.some(
        (ip) =>
          isIP(ip) !== 4 ||
          prohibited.check(ip, "ipv4") ||
          !rule.addresses.includes(ip)
      )
    ) {
      throw new Error("Destination denied");
    }
  } catch {
    throw new Error("PostgreSQL destination is not approved by the operator");
  } finally {
    signal.removeEventListener("abort", abort);
    resolver.cancel();
  }
  return addresses[0]!;
}

export function createPostgresPluginHost(adapter: DatabaseAdapter) {
  return async (
    input: unknown,
    context: PluginExecutionContext,
    signal?: AbortSignal
  ): Promise<unknown> => {
    const actor = context.webActor;
    if (context.pluginId !== "postgresql" || !actor || !context.databasePath) {
      throw denied();
    }
    // Current web sessions are organization-visible and may invoke additional
    // providers. Do not emit database content into chat until the host enforces
    // an approved session audience/provider policy. No environment bypass.
    if (context.profileId || context.sessionId) {
      throw new Error(
        "PostgreSQL agent access is unavailable until private session audience and provider policies are enforced"
      );
    }
    async function member() {
      const current = await adapter.getOrgMember(context.orgId, actor!.id);
      const user = await adapter.getUserById(actor!.id);
      if (!(current && user) || user.disabledAt || current.role === "viewer") {
        throw denied();
      }
      return current;
    }
    const current = await member();
    const db = new Database(context.databasePath);
    db.exec("PRAGMA busy_timeout=2000");
    const scope = (id: string) =>
      JSON.stringify([context.orgId, context.pluginId, id]);
    const find = (id: string) => {
      const row = db
        .query<Connection, [string]>("SELECT * FROM connections WHERE id = ?")
        .get(id);
      if (!row) {
        throw denied();
      }
      return row;
    };
    const readConfig = (row: Connection) =>
      configuration.parse(JSON.parse(row.config));
    const action = context.actionKey;
    try {
      signal?.throwIfAborted();
      db.query("INSERT OR IGNORE INTO tenant (id, org_id) VALUES (1, ?)").run(
        context.orgId
      );
      if (
        db
          .query<{ org_id: string }, []>("SELECT org_id FROM tenant WHERE id=1")
          .get()?.org_id !== context.orgId
      ) {
        throw denied();
      }
      if (action === "overview") {
        const connections = db
          .query<Connection, []>("SELECT * FROM connections ORDER BY id")
          .all()
          .flatMap((row) => {
            const config = readConfig(row);
            if (
              (current.role !== "admin" || context.profileId) &&
              (!config.userIds.includes(actor.id) ||
                (context.profileId &&
                  !config.profileIds.includes(context.profileId)))
            ) {
              return [];
            }
            return [
              {
                id: row.id,
                name: config.name,
                revision: row.revision,
                ...(current.role === "admin" && !context.profileId
                  ? { config, credentialConfigured: true }
                  : {}),
              },
            ];
          });
        return {
          canConfigure: current.role === "admin" && !context.profileId,
          connections,
          ...(current.role === "admin" && !context.profileId
            ? {
                members: (await adapter.listOrgMembers(context.orgId))
                  .filter((item) => item.role !== "viewer")
                  .map((item) => ({ id: item.userId, role: item.role })),
                profiles: (await adapter.listProfiles())
                  .filter((item) => item.orgId === context.orgId)
                  .map((item) => ({ id: item.id, name: item.name })),
              }
            : {}),
          disclosure:
            "Query results are untrusted data shared with the configured model provider and retained in web chat. Grants do not remove previously shared results.",
        };
      }
      if (action === "save_connection") {
        if (current.role !== "admin" || context.profileId) {
          throw denied();
        }
        const parsed = z
          .object({
            config: configuration,
            id: z.string().uuid().optional(),
            password: z.string().min(1).max(4096).optional(),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(input);
        const id = parsed.id ?? randomUUID();
        const old = parsed.id ? find(id) : undefined;
        if ((old?.revision ?? 0) !== parsed.revision) {
          throw new Error("Connection changed; reload before saving");
        }
        for (const userId of parsed.config.userIds) {
          const grant = await adapter.getOrgMember(context.orgId, userId);
          if (!grant || grant.role === "viewer") {
            throw denied();
          }
        }
        for (const profileId of parsed.config.profileIds) {
          if (!(await adapter.getProfileForOrg(profileId, context.orgId))) {
            throw denied();
          }
        }
        await resolvePostgresAddress(
          parsed.config.host,
          parsed.config.port,
          undefined,
          signal
        );
        signal?.throwIfAborted();
        if (old && !parsed.password) {
          const previous = readConfig(old);
          if (
            ["host", "port", "database", "username"].some(
              (key) =>
                previous[key as keyof Configuration] !==
                parsed.config[key as keyof Configuration]
            )
          ) {
            throw new Error(
              "A replacement password is required when changing the destination or role"
            );
          }
        }
        if ((await member()).role !== "admin") {
          throw denied();
        }
        const password =
          parsed.password ??
          (old ? openPostgresPassword(old.secret, scope(id)) : "");
        if (!password) {
          throw new Error("A password is required");
        }
        const secret = sealPostgresPassword(password, scope(id));
        // A revision check inside the write transaction prevents concurrent edits
        // (including a grant revocation) from being overwritten by stale saves.
        db.transaction(() => {
          signal?.throwIfAborted();
          if (old && find(id).revision !== old.revision) {
            throw new Error("Connection changed; reload before saving");
          }
          db.query(
            "INSERT INTO connections VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, config=excluded.config, secret=excluded.secret"
          ).run(id, parsed.revision + 1, JSON.stringify(parsed.config), secret);
        }).immediate();
        return { id, revision: parsed.revision + 1 };
      }
      if (action === "delete_connection") {
        if (current.role !== "admin" || context.profileId) {
          throw denied();
        }
        const parsed = z
          .object({
            connectionId: z.string().uuid(),
            revision: z.number().int(),
          })
          .strict()
          .parse(input);
        if (
          !db
            .query("DELETE FROM connections WHERE id=? AND revision=?")
            .run(parsed.connectionId, parsed.revision).changes
        ) {
          throw new Error("Connection changed; reload before deleting");
        }
        return { deleted: true };
      }
      if (!["test_connection", "schema", "query"].includes(action ?? "")) {
        throw denied();
      }
      const parsed = request.parse(input);
      const row = find(parsed.connectionId);
      const config = readConfig(row);
      const profileId = context.profileId ?? parsed.agentId;
      async function authorize() {
        const latestMember = await member();
        if (find(row.id).revision !== row.revision) {
          throw denied();
        }
        if (action === "test_connection") {
          if (latestMember.role !== "admin" || context.profileId) {
            throw denied();
          }
          return;
        }
        if (
          !(
            profileId &&
            config.userIds.includes(actor!.id) &&
            config.profileIds.includes(profileId) &&
            (await adapter.getProfileForOrg(profileId, context.orgId))
          )
        ) {
          throw denied();
        }
        if (context.profileId) {
          const assigned = await adapter.listToolsForProfile(context.profileId);
          if (
            !assigned.some(
              (tool) =>
                tool.pluginId === context.pluginId && tool.pluginKey === action
            )
          ) {
            throw denied();
          }
        }
      }
      await authorize();
      const started = Date.now();
      let status = "failed";
      try {
        const result = await readPostgres(
          config,
          openPostgresPassword(row.secret, scope(row.id)),
          parsed,
          action!,
          authorize,
          signal
        );
        await authorize();
        status = "ok";
        return result;
      } finally {
        db.query(
          "INSERT INTO audit (actor_id, profile_id, connection_id, action, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(
          actor.id,
          profileId ?? null,
          row.id,
          action!,
          status,
          Date.now() - started,
          new Date().toISOString()
        );
        db.exec(
          "DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 1000)"
        );
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error("Invalid PostgreSQL request");
      }
      throw error;
    } finally {
      db.close();
    }
  };
}

async function readPostgres(
  config: Configuration,
  password: string,
  input: z.infer<typeof request>,
  action: string,
  authorize: () => Promise<void>,
  parentSignal?: AbortSignal
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(20_000),
    ...(parentSignal ? [parentSignal] : []),
  ]);
  const address = await resolvePostgresAddress(
    config.host,
    config.port,
    undefined,
    signal
  );
  signal.throwIfAborted();
  const sql = postgres({
    connect_timeout: 5,
    connection: {
      application_name: "nakama-postgresql",
      default_transaction_read_only: true,
      idle_in_transaction_session_timeout: 5000,
      lock_timeout: 2000,
      statement_timeout: 10_000,
    },
    database: config.database,
    fetch_types: false,
    host: address,
    idle_timeout: 1,
    max: 1,
    onnotice() {},
    password,
    port: config.port,
    ssl: {
      rejectUnauthorized: true,
      servername: isIP(config.host) ? undefined : config.host,
      ...(config.ca ? { ca: config.ca } : {}),
      checkServerIdentity: (_host: string, cert: PeerCertificate) =>
        checkServerIdentity(config.host, cert),
    },
    // Preserve precision and dates as text, returning PostgreSQL type OIDs below.
    types: {
      bigint: { from: [20], parse: String, serialize: String, to: 20 },
      date: {
        from: [1082, 1114, 1184],
        parse: String,
        serialize: String,
        to: 1082,
      },
    },
    username: config.username,
  });
  const stop = () => {
    // The pinned driver patch destroys and awaits the owned TLS socket. Do not
    // use Query.cancel(): 3.4.9 discards a rejecting auxiliary-connection promise.
    void sql.end({ timeout: 0 });
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    return await sql.begin("read only", async (tx) => {
      await tx`SET LOCAL search_path = pg_catalog`;
      const [role] =
        await tx`SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls,
        EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS memberships
        FROM pg_roles r WHERE rolname = current_user`;
      if (!role || Object.values(role).some(Boolean)) {
        throw new Error("unsafe_role");
      }
      const columns: Array<{
        schema: string;
        table: string;
        name: string;
        type: number;
      }> = [];
      for (const relation of config.relations) {
        const rows = await tx`SELECT a.attname AS name, a.atttypid::int AS type,
          c.relowner = (SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
          has_table_privilege(c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS writable,
          has_any_column_privilege(c.oid, 'INSERT,UPDATE') AS column_writable,
          has_schema_privilege(n.oid, 'CREATE') AS can_create
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
          WHERE n.nspname=${relation.schema} AND c.relname=${relation.table} AND c.relkind IN ('r','p','v','m')
          AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(c.oid,a.attnum,'SELECT')
          ORDER BY a.attnum LIMIT 201`;
        if (
          !rows.length ||
          rows.length > 200 ||
          rows.some(
            (item) =>
              item.owned ||
              item.writable ||
              item.column_writable ||
              item.can_create
          )
        ) {
          throw new Error("unsafe_role");
        }
        for (const col of rows) {
          columns.push({ ...relation, name: col.name, type: col.type });
        }
      }
      await authorize();
      signal.throwIfAborted();
      if (action === "test_connection") {
        return { connected: true, readOnly: true };
      }
      if (action === "schema") {
        return {
          columns: columns.slice(0, 200),
          truncated: columns.length > 200,
          untrusted: true,
        };
      }
      const available = columns.filter(
        (col) => col.schema === input.schema && col.table === input.table
      );
      const selected =
        input.columns ?? available.map((col) => col.name).slice(0, 40);
      const valid = (name: string) =>
        available.some((col) => col.name === name);
      if (
        !(available.length && selected.length) ||
        selected.some((name) => !valid(name)) ||
        input.filters.some((filter) => !valid(filter.column)) ||
        (input.orderBy && !valid(input.orderBy))
      ) {
        throw new Error("invalid_selection");
      }
      // All identifiers come from metadata and are quoted; values are bound. No
      // user SQL, expressions, functions, joins, or transaction commands in v1.
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const values: Array<string | number | boolean | null> = [];
      const filters = input.filters.map((filter) => {
        values.push(filter.value);
        return `${quote(filter.column)} IS NOT DISTINCT FROM $${values.length}`;
      });
      const text = `SELECT ${selected.map(quote).join(",")} FROM ${quote(input.schema!)}.${quote(input.table!)}${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""}${input.orderBy ? ` ORDER BY ${quote(input.orderBy)} ${input.descending ? "DESC" : "ASC"}` : ""} LIMIT ${input.limit + 1}`;
      const rows: unknown[][] = [];
      let bytes = 0;
      let truncated = false;
      const query = tx.unsafe(text, values).values();
      for await (const batch of query.cursor(1)) {
        signal.throwIfAborted();
        const row = batch[0] as unknown[];
        const serialized = JSON.stringify(row);
        if (
          rows.length >= input.limit ||
          Buffer.byteLength(serialized) > 32_768 ||
          bytes + Buffer.byteLength(serialized) > 240_000
        ) {
          truncated = true;
          break;
        }
        bytes += Buffer.byteLength(serialized);
        rows.push(row);
      }
      return {
        columns: selected.map(
          (name) => available.find((col) => col.name === name)!
        ),
        rows,
        truncated,
        untrusted: true,
      };
    });
  } catch {
    // PostgreSQL errors may contain query values, credentials, or malicious text.
    throw new Error(
      signal.aborted
        ? "PostgreSQL request cancelled or timed out"
        : "PostgreSQL read failed; check TLS, connection, restricted role, and selection"
    );
  } finally {
    signal.removeEventListener("abort", stop);
    await sql.end({ timeout: 0 });
  }
}
