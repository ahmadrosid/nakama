import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  type CustomModelEntry,
  NakamaApiError,
  type XaiOAuthCredentials,
  type XaiOAuthDeviceStartResponse,
} from "@nakama/core";

// xAI's public device client, also used by Hermes. Endpoints are pinned to
// https://auth.x.ai/.well-known/openid-configuration.
const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const XAI_OAUTH_BASE_URL = "https://api.x.ai/v1";
const sessions = new Map<
  string,
  { owner: string; deviceCode: string; expiresAt: number; interval: number }
>();

async function postForm(
  url: string,
  data: Record<string, string>,
  signal?: AbortSignal
) {
  return fetch(url, {
    body: new URLSearchParams({ client_id: CLIENT_ID, ...data }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
}

function readTokens(
  payload: Record<string, unknown>,
  fallbackRefresh?: string
): XaiOAuthCredentials {
  const refreshToken = payload.refresh_token ?? fallbackRefresh;
  if (
    typeof payload.access_token !== "string" ||
    !payload.access_token.trim() ||
    typeof refreshToken !== "string" ||
    !refreshToken.trim() ||
    typeof payload.expires_in !== "number" ||
    !Number.isFinite(payload.expires_in) ||
    payload.expires_in <= 0
  ) {
    throw new Error("Grok OAuth returned invalid credentials. Sign in again.");
  }
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    refreshToken,
  };
}

function authError(status: number): Error {
  if (status === 403 || status === 402) {
    return new Error(
      `Grok subscription access denied (${status}). Check your xAI plan's API eligibility and remaining quota.`
    );
  }
  return new Error(`Grok OAuth failed (${status}). Try signing in again.`);
}

export async function startXaiOAuthDeviceSession(
  owner: string
): Promise<XaiOAuthDeviceStartResponse> {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= Date.now() || session.owner === owner) {
      sessions.delete(id);
    }
  }
  const response = await postForm("https://auth.x.ai/oauth2/device/code", {
    scope: "openid profile email offline_access grok-cli:access api:access",
  });
  if (!response.ok) {
    throw authError(response.status);
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (
    typeof data.device_code !== "string" ||
    !data.device_code ||
    typeof data.user_code !== "string" ||
    !data.user_code ||
    typeof data.verification_uri !== "string" ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    typeof data.interval !== "number" ||
    !Number.isFinite(data.interval) ||
    data.interval < 0
  ) {
    throw new Error("Grok device authorization returned an invalid response.");
  }
  const uri =
    trustedXaiVerificationUri(data.verification_uri_complete) ??
    trustedXaiVerificationUri(data.verification_uri);
  if (!uri) {
    throw new Error("Grok returned an invalid sign-in URL.");
  }
  const sessionId = randomUUID();
  const interval = Math.max(1, data.interval);
  sessions.set(sessionId, {
    deviceCode: data.device_code,
    expiresAt: Date.now() + Math.min(data.expires_in, 1800) * 1000,
    interval,
    owner,
  });
  return {
    intervalSeconds: interval,
    sessionId,
    userCode: data.user_code,
    verificationUri: uri,
  };
}

function trustedXaiVerificationUri(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const uri = new URL(value);
    if (
      uri.protocol !== "https:" ||
      !["auth.x.ai", "accounts.x.ai"].includes(uri.hostname) ||
      uri.username ||
      uri.password ||
      uri.port
    ) {
      return null;
    }
    return uri.toString();
  } catch {
    return null;
  }
}

export async function completeXaiOAuthDeviceSession(
  sessionId: string,
  owner: string,
  signal?: AbortSignal
): Promise<XaiOAuthCredentials> {
  const session = sessions.get(sessionId);
  if (!session || session.owner !== owner || session.expiresAt <= Date.now()) {
    throw new NakamaApiError("Grok sign-in session expired. Start again.", 400);
  }
  // Claim once: concurrent completion requests must not redeem the same grant.
  sessions.delete(sessionId);
  const deadline = AbortSignal.timeout(
    Math.max(1, session.expiresAt - Date.now())
  );
  const pollingSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let interval = session.interval * 1000;
  while (!pollingSignal.aborted) {
    await delay(interval, undefined, { signal: pollingSignal });
    const response = await postForm(
      TOKEN_URL,
      {
        device_code: session.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      pollingSignal
    );
    const payload = (await response.json()) as Record<string, unknown>;
    if (response.ok) {
      return readTokens(payload);
    }
    if (payload.error === "authorization_pending") {
      continue;
    }
    if (payload.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (payload.error === "access_denied") {
      throw new Error("Grok sign-in was denied.");
    }
    if (payload.error === "expired_token") {
      throw new Error("Grok sign-in expired. Start again.");
    }
    throw authError(response.status);
  }
  throw new Error("Grok sign-in timed out or was cancelled.");
}

export async function refreshXaiOAuthToken(
  refreshToken: string
): Promise<XaiOAuthCredentials> {
  const response = await postForm(TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!response.ok) {
    throw authError(response.status);
  }
  return readTokens(
    (await response.json()) as Record<string, unknown>,
    refreshToken
  );
}

export async function fetchXaiOAuthModels(
  oauth: XaiOAuthCredentials
): Promise<CustomModelEntry[]> {
  const response = await fetch(`${XAI_OAUTH_BASE_URL}/language-models`, {
    headers: { Authorization: `Bearer ${oauth.accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw authError(response.status);
  }
  const payload = (await response.json()) as { models?: { id?: unknown }[] };
  const models = (payload.models ?? []).flatMap((row) =>
    typeof row.id === "string" && row.id.trim()
      ? [{ id: row.id, name: row.id }]
      : []
  );
  if (!models.length) {
    throw new Error("Grok returned no language models for this account.");
  }
  return models;
}

const refreshes = new Map<string, Promise<XaiOAuthCredentials>>();

export async function resolveXaiOAuthCredentials(
  getOAuth: () => XaiOAuthCredentials | null,
  onRefresh: (oauth: XaiOAuthCredentials) => Promise<void>
): Promise<XaiOAuthCredentials> {
  const current = getOAuth();
  if (!current) {
    throw new Error(
      "Grok is not connected. Reconnect in Settings → LLM providers."
    );
  }
  if (Date.parse(current.expiresAt) > Date.now() + 60_000) {
    return current;
  }
  const existing = refreshes.get(current.refreshToken);
  if (existing) {
    return existing;
  }
  // Hold the lock through persistence: xAI refresh tokens are single-use.
  const pending = (async () => {
    const refreshed = await refreshXaiOAuthToken(current.refreshToken);
    const latest = getOAuth();
    if (!latest) {
      throw new Error("Grok was disconnected during token refresh.");
    }
    if (latest.refreshToken !== current.refreshToken) {
      return latest;
    }
    await onRefresh(refreshed);
    return refreshed;
  })();
  refreshes.set(current.refreshToken, pending);
  try {
    return await pending;
  } finally {
    refreshes.delete(current.refreshToken);
  }
}
