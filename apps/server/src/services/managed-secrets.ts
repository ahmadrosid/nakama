import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  apiKeyEnvVarForProvider,
  getComposioConfigPath,
  getUserConfigDir,
  getUserConfigPath,
  parseIni,
  parseIniWithSections,
  readEnvValue,
  readTextOrNull,
  type UserProviderName,
  writeParsedConfigIni,
} from "@nakama/core";
import { parseProviderName } from "@nakama/core/provider-resolution";
import type { DatabaseAdapter, StoredManagedSecret } from "@nakama/db";

export type ManagedSecretSource = "environment" | "settings" | "missing";

export function providerSecretEnvNames(
  providerId: string,
  type: UserProviderName
): string[] {
  const instanceName = `NAKAMA_PROVIDER_API_KEY_${providerId.replaceAll("-", "").toUpperCase()}`;
  const typeName = apiKeyEnvVarForProvider(type);
  return typeName ? [instanceName, typeName] : [instanceName];
}

export function toolSecretEnvName(orgId: string, toolId: string): string {
  const digest = createHash("sha256")
    .update(orgId)
    .update("\0")
    .update(toolId)
    .digest("hex")
    .toUpperCase();
  return `NAKAMA_TOOL_API_KEY_${digest}`;
}

export class ManagedSecrets {
  private readonly key: Buffer | null;

  constructor(
    private readonly db: DatabaseAdapter,
    encodedKey = process.env.NAKAMA_SECRETS_KEY
  ) {
    if (!encodedKey) {
      this.key = null;
      return;
    }
    const key = Buffer.from(encodedKey, "base64");
    if (key.length !== 32 || key.toString("base64") !== encodedKey) {
      throw new Error("NAKAMA_SECRETS_KEY must be 32 random bytes in base64.");
    }
    this.key = key;
  }

  async checkIntegrity(): Promise<void> {
    for (const row of await this.db.listManagedSecrets()) {
      if (row.encryptedValue) {
        this.decrypt(row);
      }
    }
  }

  async resolve(
    scope: string,
    name: string,
    envNames: string[] = [],
    env: Record<string, string | undefined> = process.env
  ): Promise<{
    source: ManagedSecretSource;
    value: string | null;
    version: number;
  }> {
    const override = envNames
      .map((key) => readEnvValue(env, key))
      .find(Boolean);
    const row = await this.db.getManagedSecret(scope, name);
    if (override) {
      if (row?.source !== "environment") {
        await this.db.putManagedSecret({
          encryptedValue: row?.encryptedValue ?? null,
          name,
          scope,
          source: "environment",
        });
      }
      return {
        source: "environment",
        value: override,
        version:
          row?.source === "environment" ? row.version : (row?.version ?? 0) + 1,
      };
    }
    if (row?.source === "settings" && row.encryptedValue) {
      return {
        source: "settings",
        value: this.decrypt(row),
        version: row.version,
      };
    }
    return { source: "missing", value: null, version: row?.version ?? 0 };
  }

  async save(
    scope: string,
    name: string,
    value: string,
    envNames: string[] = []
  ): Promise<void> {
    if (!value || /[\r\n\0]/.test(value) || value.length > 8192) {
      throw new Error("Enter a valid secret.");
    }
    if (envNames.some((key) => readEnvValue(process.env, key))) {
      throw new Error("This secret is managed by the environment.");
    }
    await this.db.putManagedSecret({
      encryptedValue: this.encrypt(scope, name, value),
      name,
      scope,
      source: "settings",
    });
  }

  async migrate(
    scope: string,
    name: string,
    value: string,
    envNames: string[] = []
  ): Promise<void> {
    const current = await this.db.getManagedSecret(scope, name);
    if (current) {
      return;
    }
    const override = envNames
      .map((key) => readEnvValue(process.env, key))
      .find(Boolean);
    await this.db.putManagedSecret({
      encryptedValue: override ? null : this.encrypt(scope, name, value),
      name,
      scope,
      source: override ? "environment" : "settings",
    });
    const stored = await this.db.getManagedSecret(scope, name);
    if (
      !override &&
      (!stored?.encryptedValue || this.decrypt(stored) !== value)
    ) {
      throw new Error("Secret migration verification failed.");
    }
  }

  async useStored(
    scope: string,
    name: string,
    envNames: string[] = []
  ): Promise<void> {
    if (envNames.some((key) => readEnvValue(process.env, key))) {
      throw new Error("This secret is managed by the environment.");
    }
    const row = await this.db.getManagedSecret(scope, name);
    if (!row?.encryptedValue) {
      throw new Error("No saved Settings secret is available.");
    }
    this.decrypt(row);
    await this.db.putManagedSecret({
      encryptedValue: row.encryptedValue,
      name,
      scope,
      source: "settings",
    });
  }

  async status(
    scope: string,
    name: string,
    envNames: string[] = []
  ): Promise<{
    configured: boolean;
    envName: string | null;
    savedAvailable: boolean;
    source: ManagedSecretSource;
  }> {
    const resolved = await this.resolve(scope, name, envNames);
    const row = await this.db.getManagedSecret(scope, name);
    return {
      configured: Boolean(resolved.value),
      envName: envNames.find((key) => readEnvValue(process.env, key)) ?? null,
      savedAvailable: Boolean(row?.encryptedValue),
      source: resolved.source,
    };
  }

  async delete(scope: string, name: string): Promise<void> {
    await this.db.deleteManagedSecret(scope, name);
  }

  list(): Promise<StoredManagedSecret[]> {
    return this.db.listManagedSecrets();
  }

  async fingerprint(): Promise<string> {
    const hash = createHash("sha256");
    const rows = await this.db.listManagedSecrets();
    for (const row of rows.sort((a, b) =>
      `${a.scope}:${a.name}`.localeCompare(`${b.scope}:${b.name}`)
    )) {
      hash.update(
        JSON.stringify([
          row.scope,
          row.name,
          row.source,
          row.version,
          row.encryptedValue,
        ])
      );
    }
    return hash.digest("hex");
  }

  async rotateKey(nextEncodedKey: string): Promise<void> {
    const next = new ManagedSecrets(this.db, nextEncodedKey);
    if (!next.key) {
      throw new Error("Set the new NAKAMA_SECRETS_KEY before rotation.");
    }
    const replacements: Array<
      Pick<StoredManagedSecret, "scope" | "name" | "encryptedValue">
    > = [];
    for (const row of await this.db.listManagedSecrets()) {
      if (!row.encryptedValue) {
        continue;
      }
      const plain = this.decrypt(row);
      const encryptedValue = next.encrypt(row.scope, row.name, plain);
      if (next.decrypt({ ...row, encryptedValue }) !== plain) {
        throw new Error("Secret key rotation verification failed.");
      }
      replacements.push({ encryptedValue, name: row.name, scope: row.scope });
    }
    await this.db.replaceManagedSecrets(replacements);
  }

  async migrateLegacyFiles(rootDir = getUserConfigDir()): Promise<void> {
    await this.checkIntegrity();
    const configPath =
      rootDir === getUserConfigDir()
        ? getUserConfigPath()
        : join(rootDir, "config.ini");
    const raw = await readTextOrNull(configPath);
    if (raw !== null) {
      const parsed = parseIniWithSections(raw);
      let needsRewrite = false;
      for (const [section, values] of Object.entries(parsed.sections)) {
        needsRewrite ||=
          "api_key" in values || (section === "email" && "password" in values);
        const apiKey = values.api_key?.trim();
        if (apiKey) {
          if (section.startsWith("provider.")) {
            const providerId = section.slice("provider.".length);
            const providerType = parseProviderName(values.type);
            if (!(providerId && providerType)) {
              throw new Error(
                `Cannot migrate invalid provider section: ${section}`
              );
            }
            await this.migrate(
              "global",
              `provider:${providerId}`,
              apiKey,
              providerSecretEnvNames(providerId, providerType)
            );
          } else if (section === "web_search") {
            if (values.provider !== "exa" && values.provider !== "firecrawl") {
              throw new Error("Cannot migrate an unknown web search provider.");
            }
            const envName =
              values.provider === "firecrawl"
                ? "FIRECRAWL_API_KEY"
                : "EXA_API_KEY";
            await this.migrate(
              "global",
              `web-search:${values.provider}`,
              apiKey,
              [envName]
            );
          } else if (section.startsWith("tool-key.")) {
            const ids: unknown = JSON.parse(
              Buffer.from(
                section.slice("tool-key.".length),
                "base64url"
              ).toString("utf8")
            );
            if (
              !Array.isArray(ids) ||
              ids.length !== 2 ||
              ids.some((id) => typeof id !== "string" || !id)
            ) {
              throw new Error(
                `Cannot migrate invalid tool key section: ${section}`
              );
            }
            await this.migrate(ids[0], `tool:${ids[1]}`, apiKey, [
              toolSecretEnvName(ids[0], ids[1]),
            ]);
          } else {
            throw new Error(
              `Cannot migrate unknown API key section: ${section}`
            );
          }
        }
        if (section === "email" && values.password?.trim()) {
          await this.migrate("global", "email", values.password.trim(), [
            "NAKAMA_EMAIL_PASSWORD",
          ]);
        }
      }
      if (needsRewrite) {
        await writeParsedConfigIni(
          parsed.global,
          parsed.sections,
          {},
          configPath
        );
      }
    }
    const composioPath =
      rootDir === getUserConfigDir()
        ? getComposioConfigPath()
        : join(rootDir, "composio", "config.ini");
    const composioRaw = await readTextOrNull(composioPath);
    if (composioRaw !== null) {
      const key = parseIni(composioRaw).api_key?.trim();
      if (key) {
        await this.migrate("global", "composio", key, ["COMPOSIO_API_KEY"]);
      }
      await unlink(composioPath);
    }
  }

  private encrypt(scope: string, name: string, value: string): string {
    if (!this.key) {
      throw new Error("Set NAKAMA_SECRETS_KEY before saving secrets.");
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([scope, name])));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":");
  }

  private decrypt(row: StoredManagedSecret): string {
    if (!this.key) {
      throw new Error("NAKAMA_SECRETS_KEY is required for saved secrets.");
    }
    const parts = row.encryptedValue?.split(":");
    if (parts?.length !== 4 || parts[0] !== "v1") {
      throw new Error("Saved secret format is invalid.");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(parts[1]!, "base64url")
      );
      decipher.setAAD(Buffer.from(JSON.stringify([row.scope, row.name])));
      decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[3]!, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Cannot decrypt saved secrets with NAKAMA_SECRETS_KEY.");
    }
  }
}
