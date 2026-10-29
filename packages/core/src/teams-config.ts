import { join } from "node:path";
import { z } from "zod";
import { createChatLock } from "./channel-chat-lock";
import {
  assertChannelPath,
  type ChannelOwner,
  claimChannelIdentity,
  getChannelConfigDir,
  releaseChannelClaims,
  resetChannelConversationState,
} from "./channel-config-shared";
import type {
  TeamsSettingsResponse,
  UpdateTeamsSettingsRequest,
} from "./contract";
import { parseIni, readTextOrNull, writeTextFile } from "./fs";

const guidSchema = z
  .string()
  .regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i)
  .transform((value) => value.toLowerCase());

const configSchema = z.object({
  allowedUserIds: z.array(guidSchema),
  clientId: guidSchema,
  clientSecret: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[^\r\n\0]+$/),
  inboundPort: z.number().int().min(1).max(65_535).nullable(),
  profileId: z.string(),
  tenantId: guidSchema,
});

export type TeamsConfigFile = z.infer<typeof configSchema>;

const configLock = createChatLock();

export function getTeamsConfigDir(owner: ChannelOwner): string {
  return getChannelConfigDir("teams", owner);
}

export function getTeamsConfigPath(owner: ChannelOwner): string {
  const path = join(getTeamsConfigDir(owner), "config.ini");
  assertChannelPath(path);

  return path;
}

export async function loadTeamsConfigFile(
  owner: ChannelOwner
): Promise<TeamsConfigFile | null> {
  const raw = await readTextOrNull(getTeamsConfigPath(owner));

  if (raw === null) {
    return null;
  }

  const values = parseIni(raw);

  const config = configSchema.parse({
    allowedUserIds: values.allowed_user_ids?.split(",").filter(Boolean) ?? [],
    clientId: values.client_id,
    clientSecret: values.client_secret,
    inboundPort: values.inbound_port ? Number(values.inbound_port) : null,
    profileId: values.profile_id,
    tenantId: values.tenant_id,
  });

  if (config.profileId !== owner.profileId) {
    throw new Error("Invalid Teams connection owner.");
  }

  return config;
}

function messagingEndpoint(owner: ChannelOwner): string | null {
  try {
    const url = new URL(process.env.NAKAMA_WEB_PUBLIC_URL?.trim() ?? "");

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/channels/teams/${encodeURIComponent(owner.profileId)}/messages`;

    return url.toString();
  } catch {
    return null;
  }
}

export async function loadTeamsSettingsPublic(
  owner: ChannelOwner
): Promise<TeamsSettingsResponse> {
  const config = await loadTeamsConfigFile(owner);

  return {
    allowedUserIds: config?.allowedUserIds ?? [],
    clientId: config?.clientId ?? null,
    clientSecretConfigured: Boolean(config?.clientSecret),
    configured: config !== null,
    messagingEndpoint: messagingEndpoint(owner),
    profileId: owner.profileId,
    tenantId: config?.tenantId ?? null,
  };
}

export async function validateTeamsCredentials(
  config: Pick<TeamsConfigFile, "tenantId" | "clientId" | "clientSecret">
): Promise<void> {
  const tenantId = guidSchema.parse(config.tenantId);
  const clientId = guidSchema.parse(config.clientId);

  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: config.clientSecret,
          grant_type: "client_credentials",
          scope: "https://api.botframework.com/.default",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      throw new Error("Token request rejected");
    }

    const token = z
      .object({
        access_token: z.string().min(1),
        token_type: z.literal("Bearer"),
      })
      .safeParse(await response.json());

    if (!token.success) {
      throw new Error("Invalid token response");
    }
  } catch {
    throw new Error("Teams credentials could not be validated.");
  }
}

async function writeTeamsConfig(
  config: TeamsConfigFile,
  owner: ChannelOwner
): Promise<void> {
  await writeTextFile(
    getTeamsConfigPath(owner),
    [
      `tenant_id = ${config.tenantId}`,
      `client_id = ${config.clientId}`,
      `client_secret = ${config.clientSecret}`,
      `profile_id = ${owner.profileId}`,
      `allowed_user_ids = ${config.allowedUserIds.join(",")}`,
      `inbound_port = ${config.inboundPort ?? ""}`,
      "",
    ].join("\n"),
    { ensureDir: getTeamsConfigDir(owner) }
  );
}

export async function saveTeamsConfig(
  input: UpdateTeamsSettingsRequest,
  owner: ChannelOwner
): Promise<TeamsSettingsResponse> {
  return configLock.withLock(getTeamsConfigPath(owner), async () => {
    const existing = await loadTeamsConfigFile(owner);

    if (input.profileId !== undefined && input.profileId !== owner.profileId) {
      throw new Error("Invalid Teams connection owner.");
    }

    const config = configSchema.parse({
      allowedUserIds:
        input.allowedUserIds === undefined
          ? (existing?.allowedUserIds ?? [])
          : [
              ...new Set(
                input.allowedUserIds
                  .split(",")
                  .map((value) => value.trim().toLowerCase())
                  .filter(Boolean)
              ),
            ],
      clientId: input.clientId?.trim() || existing?.clientId,
      clientSecret: input.clientSecret?.trim() || existing?.clientSecret,
      inboundPort: existing?.inboundPort ?? null,
      profileId: owner.profileId,
      tenantId: input.tenantId?.trim() || existing?.tenantId,
    });

    if (
      !existing ||
      config.clientId !== existing.clientId ||
      config.tenantId !== existing.tenantId ||
      config.clientSecret !== existing.clientSecret
    ) {
      await validateTeamsCredentials(config);
    }

    const changed =
      existing &&
      (existing.clientId !== config.clientId ||
        existing.tenantId !== config.tenantId);

    if (changed) {
      config.inboundPort = null;
    }

    const rollbackClaim = await claimChannelIdentity(
      "teams",
      owner,
      config.clientId
    );

    try {
      await writeTeamsConfig(config, owner);
    } catch (error) {
      await rollbackClaim();
      throw error;
    }

    await releaseChannelClaims("teams", owner, config.clientId);

    if (changed) {
      await resetChannelConversationState("teams", owner);
    }

    return loadTeamsSettingsPublic(owner);
  });
}

export async function saveTeamsInboundPort(
  port: number | null,
  owner: ChannelOwner
): Promise<void> {
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error("Invalid Teams worker port.");
  }

  await configLock.withLock(getTeamsConfigPath(owner), async () => {
    const config = await loadTeamsConfigFile(owner);

    if (!config) {
      throw new Error("Teams is not configured.");
    }

    await writeTeamsConfig({ ...config, inboundPort: port }, owner);
  });
}
