import {
  NakamaAuthExpiredError,
  readApiErrorMessage,
} from "@nakama/core/api-error";
import {
  HOST_BOUND_BROWSER_SESSION_COOKIE_NAMES,
  PLAIN_BROWSER_SESSION_COOKIE_NAMES,
} from "@nakama/core/browser-session-cookies";
import type { AuthUserResponse } from "@nakama/core/contract";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { resolveServerUrl } from "@nakama/core/runtime";
import { readCookie } from "./browser";
import { createApiError, isMutatingMethod } from "./client-helpers";
import type { NakamaClientOptions } from "./types";

/** Connection state and the request plumbing every domain method uses. */
export class NakamaClientCore {
  readonly baseUrl: string;
  protected readonly fetchImpl: NonNullable<NakamaClientOptions["fetch"]>;
  protected readonly credentials: RequestCredentials;
  protected readonly clientOrigin: string | null;
  protected authToken: string | null;
  protected orgId: string | null;
  protected orgScopeRevision = 0;
  protected activeOrgRequestRevision = 0;

  constructor(options: NakamaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveServerUrl()).replace(/\/$/, "");
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.fetchImpl = fetchFn;
    this.credentials = options.credentials ?? "include";
    this.clientOrigin = options.clientOrigin?.trim().replace(/\/$/, "") || null;
    this.authToken = options.authToken ?? null;
    this.orgId = options.orgId ?? null;
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  setOrgId(orgId: string | null): void {
    this.orgScopeRevision += 1;
    this.orgId = orgId?.trim() || null;
  }

  protected applyAuthUserResponse(response: AuthUserResponse): void {
    const activeOrgId = response.activeOrgId ?? response.orgId ?? null;
    this.setOrgId(activeOrgId);
  }

  protected async request<T>(
    path: string,
    init?: RequestInit,
    retried = false
  ): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();

    const headers = this.buildHeaders(method, init?.headers, {
      hasBody: init?.body != null,
    });

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: this.credentials,
      headers,
    });

    if (!response.ok) {
      if (
        response.status === 401 &&
        this.authToken &&
        (retried || path !== "/v1/auth/local-token/rotate")
      ) {
        if (!retried) {
          const freshToken = await loadLocalAuthToken();

          if (freshToken && freshToken !== this.authToken) {
            this.authToken = freshToken;

            return this.request(path, init, true);
          }
        }

        throw new NakamaAuthExpiredError(
          await readApiErrorMessage(response),
          path
        );
      }

      throw await createApiError(response, path);
    }

    if (response.status === 204) {
      // SAFETY: This request's declared response type describes the empty 204 success contract.
      return undefined as T;
    }

    // SAFETY: The typed request caller owns the JSON response contract for this endpoint.
    return (await response.json()) as T;
  }

  protected async fetchRaw(
    path: string,
    init?: RequestInit,
    retried = false
  ): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();

    const headers = this.buildHeaders(method, init?.headers, {
      hasBody: false,
    });

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      credentials: this.credentials,
      headers,
    });

    if (!response.ok) {
      if (
        response.status === 401 &&
        this.authToken &&
        (retried || path !== "/v1/auth/local-token/rotate")
      ) {
        if (!retried) {
          const freshToken = await loadLocalAuthToken();

          if (freshToken && freshToken !== this.authToken) {
            this.authToken = freshToken;

            return this.fetchRaw(path, init, true);
          }
        }

        throw new NakamaAuthExpiredError(
          await readApiErrorMessage(response),
          path
        );
      }

      throw await createApiError(response, path);
    }

    return response;
  }

  protected buildHeaders(
    method: string,
    headers?: HeadersInit,
    options: { hasBody?: boolean } = {}
  ): Record<string, string> {
    const merged = new Headers(headers);

    if (options.hasBody && !merged.has("Content-Type")) {
      merged.set("Content-Type", "application/json");
    }

    if (this.authToken) {
      merged.set("Authorization", `Bearer ${this.authToken}`);
    }

    if (this.orgId && !merged.has("X-Org-Id")) {
      merged.set("X-Org-Id", this.orgId);
    }

    if (isMutatingMethod(method)) {
      // HTTPS deployments issue the host-bound cookie; plain HTTP uses the
      // unprefixed one. A cookie planted by a sibling host is never read on
      // HTTPS because the server only trusts the prefixed name there.
      const csrfToken =
        readCookie(HOST_BOUND_BROWSER_SESSION_COOKIE_NAMES.csrf) ??
        readCookie(PLAIN_BROWSER_SESSION_COOKIE_NAMES.csrf);

      if (csrfToken) {
        merged.set("X-CSRF-Token", csrfToken);
      }
    }

    return Object.fromEntries(merged.entries());
  }
}
