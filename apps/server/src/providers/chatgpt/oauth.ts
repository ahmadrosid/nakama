import { randomUUID } from "node:crypto";
import type { ChatgptOAuthCredentials, CustomModelEntry } from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import type { ChatgptOAuthDeviceStartResponse } from "@nakama/core/contract";

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

type TokenResponseJson = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
};

type JwtPayload = {
  [CHATGPT_JWT_CLAIM_PATH]?: {
    chatgpt_account_id?: string;
  };
};

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
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

export function readChatgptAccountIdFromAccessToken(
  accessToken: string
): string | null {
  const payload = decodeJwtPayload(accessToken);
  const accountId = payload?.[CHATGPT_JWT_CLAIM_PATH]?.chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0
    ? accountId
    : null;
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

  const json = (await response.json()) as TokenResponseJson;

  if (
    !(json.access_token && json.refresh_token) ||
    typeof json.expires_in !== "number"
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

  const json = (await response.json()) as {
    device_auth_id?: string;
    interval?: number | string;
    user_code?: string;
  };
  const intervalSeconds =
    typeof json.interval === "string"
      ? Number(json.interval.trim())
      : json.interval;

  if (
    !(json.device_auth_id && json.user_code) ||
    typeof intervalSeconds !== "number" ||
    !Number.isFinite(intervalSeconds) ||
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
    const json = (await response.json()) as {
      authorization_code?: string;
      code_verifier?: string;
    };

    if (!(json.authorization_code && json.code_verifier)) {
      return {
        message: "ChatGPT device auth returned an incomplete token response.",
        status: "failed",
      };
    }

    return {
      status: "complete",
      value: {
        authorizationCode: json.authorization_code,
        codeVerifier: json.code_verifier,
      },
    };
  }

  if (response.status === 403 || response.status === 404) {
    return { status: "pending" };
  }

  const responseBody = await response.text().catch(() => "");
  let errorCode: unknown;

  try {
    const json = JSON.parse(responseBody) as {
      error?: string | { code?: string };
    };
    const error = json.error;
    errorCode = typeof error === "object" ? error?.code : error;
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

export function parseChatgptCodexModelsPayload(
  payload: unknown
): CustomModelEntry[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as { models?: unknown };
  const rows = Array.isArray(record.models) ? record.models : [];
  const unique = new Map<string, CustomModelEntry>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const item = row as {
      display_name?: unknown;
      id?: unknown;
      slug?: unknown;
      supported_in_api?: unknown;
    };

    if (item.supported_in_api === false) {
      continue;
    }

    const id =
      (typeof item.slug === "string" && item.slug.trim()) ||
      (typeof item.id === "string" && item.id.trim()) ||
      "";

    if (!id || unique.has(id)) {
      continue;
    }

    unique.set(id, {
      id,
      name:
        typeof item.display_name === "string" && item.display_name.trim()
          ? item.display_name.trim()
          : id,
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
