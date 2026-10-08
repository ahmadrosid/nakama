import { randomUUID } from "node:crypto";
import type { ChatgptOAuthCredentials, CustomModelEntry } from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import type { ChatgptOAuthDeviceStartResponse } from "@nakama/core/contract";
import { z } from "zod";

const CHATGPT_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

const CHATGPT_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";

const CHATGPT_DEVICE_USER_CODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";

const CHATGPT_DEVICE_TOKEN_URL =
  "https://auth.openai.com/api/accounts/deviceauth/token";

const CHATGPT_DEVICE_VERIFICATION_URI = "https://auth.openai.com/codex/device";

const CHATGPT_DEVICE_REDIRECT_URI =
  "https://auth.openai.com/deviceauth/callback";

export const CHATGPT_JWT_CLAIM_PATH = "https://api.openai.com/auth";

const CHATGPT_DEVICE_CODE_TIMEOUT_MS = 15 * 60 * 1000;

export interface ChatgptDeviceAuthSession {
  deviceAuthId: string;
  intervalSeconds: number;
  userCode: string;
}

type DeviceTokenSuccess = {
  authorizationCode: string;
  codeVerifier: string;
};

const jwtPayloadSchema = z.object({
  [CHATGPT_JWT_CLAIM_PATH]: z
    .object({
      chatgpt_account_id: z.string().optional(),
    })
    .optional(),
});

const tokenResponseSchema = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().finite().positive().optional(),
  refresh_token: z.string().optional(),
});

const deviceAuthResponseSchema = z.object({
  device_auth_id: z.string().min(1),
  interval: z.union([z.number(), z.string()]),
  user_code: z.string().min(1),
});

const deviceTokenResponseSchema = z.object({
  authorization_code: z.string().min(1),
  code_verifier: z.string().min(1),
});

const deviceErrorResponseSchema = z.object({
  error: z
    .union([z.string(), z.object({ code: z.string().optional() })])
    .optional(),
});

const codexModelsResponseSchema = z.object({
  models: z
    .array(
      z.object({
        display_name: z.string().optional(),
        id: z.string().optional(),
        slug: z.string().optional(),
        supported_in_api: z.boolean().optional(),
      })
    )
    .optional(),
});

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");

    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1] ?? "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");

    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );

    const decoded = Buffer.from(padded, "base64").toString("utf8");

    const parsed = jwtPayloadSchema.safeParse(JSON.parse(decoded));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readChatgptAccountIdFromAccessToken(
  accessToken: string
): string | null {
  const payload = decodeJwtPayload(accessToken);
  const accountId = payload?.[CHATGPT_JWT_CLAIM_PATH]?.chatgpt_account_id;

  return accountId && accountId.length > 0 ? accountId : null;
}

async function readTokenResponse(
  response: Response,
  operation: "exchange" | "refresh"
): Promise<ChatgptOAuthCredentials> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ChatGPT OAuth token ${operation} failed (${response.status})${
        text ? `: ${text}` : ""
      }`
    );
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());
  const json = parsed.success ? parsed.data : null;

  if (
    !(json?.access_token && json.refresh_token) ||
    json.expires_in === undefined
  ) {
    throw new Error(
      `ChatGPT OAuth token ${operation} response missing fields.`
    );
  }

  const accountId = readChatgptAccountIdFromAccessToken(json.access_token);

  if (!accountId) {
    throw new Error("ChatGPT OAuth token is missing chatgpt_account_id.");
  }

  return {
    accessToken: json.access_token,
    accountId,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    refreshToken: json.refresh_token,
  };
}

async function startChatgptDeviceAuth(): Promise<ChatgptDeviceAuthSession> {
  const response = await fetch(CHATGPT_DEVICE_USER_CODE_URL, {
    body: JSON.stringify({ client_id: CHATGPT_CODEX_CLIENT_ID }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ChatGPT device auth start failed (${response.status})${
        text ? `: ${text}` : ""
      }`
    );
  }

  const parsed = deviceAuthResponseSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new Error("ChatGPT device auth returned an invalid response.");
  }

  const json = parsed.data;

  const intervalSeconds = Number(json.interval);

  if (
    !(
      json.device_auth_id &&
      json.user_code &&
      Number.isFinite(intervalSeconds)
    ) ||
    intervalSeconds < 0
  ) {
    throw new Error("ChatGPT device auth returned an invalid response.");
  }

  return {
    deviceAuthId: json.device_auth_id,
    intervalSeconds,
    userCode: json.user_code,
  };
}

async function pollChatgptDeviceAuthOnce(
  device: ChatgptDeviceAuthSession
): Promise<
  | { status: "complete"; value: DeviceTokenSuccess }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "failed"; message: string }
> {
  const response = await fetch(CHATGPT_DEVICE_TOKEN_URL, {
    body: JSON.stringify({
      device_auth_id: device.deviceAuthId,
      user_code: device.userCode,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (response.ok) {
    const parsed = deviceTokenResponseSchema.safeParse(await response.json());

    if (!parsed.success) {
      return {
        message: "ChatGPT device auth returned an incomplete token response.",
        status: "failed",
      };
    }

    return {
      status: "complete",
      value: {
        authorizationCode: parsed.data.authorization_code,
        codeVerifier: parsed.data.code_verifier,
      },
    };
  }

  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }

  const responseBody = await response.text().catch(() => "");
  let errorCode: unknown;

  try {
    const parsed = deviceErrorResponseSchema.safeParse(
      JSON.parse(responseBody)
    );

    if (parsed.success) {
      const error = parsed.data.error;
      errorCode =
        error instanceof Object && "code" in error ? error.code : error;
    }
  } catch {
    errorCode = undefined;
  }

  if (errorCode === "deviceauth_authorization_pending") {
    return { status: "pending" };
  }

  if (errorCode === "slow_down") {
    return { status: "slow_down" };
  }

  return {
    message: `ChatGPT device auth failed (${response.status})${
      responseBody ? `: ${responseBody}` : ""
    }`,
    status: "failed",
  };
}

async function exchangeChatgptAuthorizationCode(
  authorizationCode: string,
  codeVerifier: string,
  redirectUri: string
): Promise<ChatgptOAuthCredentials> {
  const response = await fetch(CHATGPT_OAUTH_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: CHATGPT_CODEX_CLIENT_ID,
      code: authorizationCode,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  return readTokenResponse(response, "exchange");
}

export function parseChatgptCodexModelsPayload<Value>(
  payload: Value
): CustomModelEntry[] {
  const parsed = codexModelsResponseSchema.safeParse(payload);

  if (!parsed.success) {
    return [];
  }

  const rows = parsed.data.models ?? [];
  const unique = new Map<string, CustomModelEntry>();

  for (const row of rows) {
    if (row.supported_in_api === false) {
      continue;
    }

    const id = row.slug?.trim() || row.id?.trim() || "";

    if (!id || unique.has(id)) {
      continue;
    }

    unique.set(id, {
      id,
      name: row.display_name?.trim() ? row.display_name.trim() : id,
      supportsVision: true,
    });
  }

  return [...unique.values()];
}

export async function fetchChatgptCodexModels(
  oauth: ChatgptOAuthCredentials,
  onTokenRefresh?: (oauth: ChatgptOAuthCredentials) => Promise<void>
): Promise<CustomModelEntry[]> {
  const fetchModels = (credentials: ChatgptOAuthCredentials) =>
    fetch(`${CHATGPT_CODEX_BASE_URL}/models?client_version=1.0.0`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.accessToken}`,
        "ChatGPT-Account-ID": credentials.accountId,
        "OpenAI-Beta": "responses=v1",
        originator: "codex_cli_rs",
      },
    });

  let response = await fetchModels(oauth);

  // The upstream can reject a token before its stored expiry. Refresh once,
  // and persist rotated credentials before making another request.
  if (response.status === 401 && onTokenRefresh) {
    await response.body?.cancel();
    let refreshed: ChatgptOAuthCredentials;

    try {
      refreshed = await refreshChatgptOAuthToken(oauth.refreshToken);
    } catch {
      throw new NakamaApiError(
        "ChatGPT sign-in expired. Reconnect in Settings → LLM providers.",
        400
      );
    }

    await onTokenRefresh(refreshed);
    response = await fetchModels(refreshed);
  }

  if (response.status === 401) {
    await response.body?.cancel();
    throw new NakamaApiError(
      "ChatGPT sign-in expired. Reconnect in Settings → LLM providers.",
      400
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `ChatGPT models failed (${response.status})${text ? `: ${text}` : ""}`
    );
  }

  const models = parseChatgptCodexModelsPayload(await response.json());

  if (models.length === 0) {
    throw new Error("ChatGPT returned no models for this account.");
  }

  return models;
}

export async function refreshChatgptOAuthToken(
  refreshToken: string
): Promise<ChatgptOAuthCredentials> {
  const response = await fetch(CHATGPT_OAUTH_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: CHATGPT_CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  return readTokenResponse(response, "refresh");
}

export async function completeChatgptDeviceAuth(
  device: ChatgptDeviceAuthSession,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<ChatgptOAuthCredentials> {
  const timeoutMs = options.timeoutMs ?? CHATGPT_DEVICE_CODE_TIMEOUT_MS;
  const startedAt = Date.now();
  let intervalMs = Math.max(device.intervalSeconds, 1) * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      throw new Error("ChatGPT sign-in was cancelled.");
    }

    const result = await pollChatgptDeviceAuthOnce(device);

    if (result.status === "complete") {
      return exchangeChatgptAuthorizationCode(
        result.value.authorizationCode,
        result.value.codeVerifier,
        CHATGPT_DEVICE_REDIRECT_URI
      );
    }

    if (result.status === "failed") {
      throw new Error(result.message);
    }

    if (result.status === "slow_down") {
      intervalMs = Math.min(intervalMs + 5000, 15_000);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error("ChatGPT sign-in timed out. Try again.");
}

const deviceSessions = new Map<
  string,
  { createdAt: number; device: ChatgptDeviceAuthSession }
>();

export async function startChatgptOAuthDeviceSession(): Promise<ChatgptOAuthDeviceStartResponse> {
  const device = await startChatgptDeviceAuth();
  const sessionId = randomUUID();
  deviceSessions.set(sessionId, { createdAt: Date.now(), device });

  return {
    intervalSeconds: device.intervalSeconds,
    sessionId,
    userCode: device.userCode,
    verificationUri: CHATGPT_DEVICE_VERIFICATION_URI,
  };
}

export async function completeChatgptOAuthDeviceSession(
  sessionId: string
): Promise<ChatgptOAuthCredentials> {
  const session = deviceSessions.get(sessionId);

  if (!session) {
    throw new NakamaApiError(
      "ChatGPT sign-in session expired. Start again.",
      400
    );
  }

  try {
    return await completeChatgptDeviceAuth(session.device);
  } finally {
    deviceSessions.delete(sessionId);
  }
}
