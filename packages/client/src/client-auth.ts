import type {
  AcceptOrgInviteRequest,
  AcceptOrgInviteResponse,
  AuthUserResponse,
  ChangePasswordRequest,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  ListBrowserSessionsResponse,
  ListUserOrgsResponse,
  MfaBackupCodesResponse,
  MfaPolicyResponse,
  MfaTotpStartResponse,
  MfaTotpVerifyResponse,
  PasskeyAuthenticationOptionsResponse,
  PasskeyCredentialResponse,
  PasskeyRegistrationOptionsResponse,
  PasskeyVerificationResponse,
  RequestPasswordResetRequest,
  RequestPasswordResetResponse,
  ResetPasswordRequest,
  RevokeBrowserSessionsResponse,
  RotateLocalAuthTokenResponse,
  SetupAuthRequest,
  UpdateAuthProfileRequest,
} from "@nakama/core/contract";
import { ChannelsClient } from "./client-channels";

/** Sign-in, MFA, passkeys, the signed-in user, and browser sessions. */
export class AuthClient extends ChannelsClient {
  async setupUser(request: SetupAuthRequest): Promise<AuthUserResponse> {
    const scopeRevision = this.orgScopeRevision;

    const response = await this.request<AuthUserResponse>("/v1/auth/setup", {
      body: JSON.stringify(request),
      method: "POST",
    });

    if (scopeRevision === this.orgScopeRevision) {
      this.applyAuthUserResponse(response);
    }

    return response;
  }

  async login(
    email: string,
    password: string,
    mfa?: {
      backupCode?: string;
      mfaCode?: string;
      passkey?: PasskeyCredentialResponse;
      passkeyChallenge?: string;
    }
  ): Promise<AuthUserResponse> {
    const scopeRevision = this.orgScopeRevision;

    const response = await this.request<AuthUserResponse>("/v1/auth/login", {
      body: JSON.stringify({ email, password, ...mfa }),
      method: "POST",
    });

    if (scopeRevision === this.orgScopeRevision) {
      this.applyAuthUserResponse(response);
    }

    return response;
  }
  async getPasskeyLoginOptions(): Promise<PasskeyAuthenticationOptionsResponse> {
    return this.request<PasskeyAuthenticationOptionsResponse>(
      "/v1/auth/passkey/login/options",
      {
        body: JSON.stringify({}),
        method: "POST",
      }
    );
  }
  async getMfaPolicy(): Promise<MfaPolicyResponse> {
    return this.request<MfaPolicyResponse>("/v1/settings/mfa");
  }

  async updateMfaPolicy(
    request: Partial<
      Pick<MfaPolicyResponse, "enabled" | "enforcedRoles" | "required">
    >
  ): Promise<MfaPolicyResponse> {
    return this.request<MfaPolicyResponse>("/v1/settings/mfa", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async startTotp(): Promise<MfaTotpStartResponse> {
    return this.request<MfaTotpStartResponse>("/v1/auth/mfa/totp/start", {
      method: "POST",
    });
  }
  async generateBackupCodes(input: {
    mfaCode?: string;
    passkey?: PasskeyCredentialResponse;
    passkeyChallenge?: string;
    password?: string;
  }): Promise<MfaBackupCodesResponse> {
    return this.request<MfaBackupCodesResponse>("/v1/auth/mfa/backup-codes", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async startPasskey(): Promise<PasskeyRegistrationOptionsResponse> {
    return this.request<PasskeyRegistrationOptionsResponse>(
      "/v1/auth/mfa/passkey/start",
      { method: "POST" }
    );
  }

  async verifyPasskey(
    challenge: string,
    credential: PasskeyCredentialResponse,
    name?: string
  ): Promise<PasskeyVerificationResponse> {
    const body = { challenge, credential, name: name || undefined };

    return this.request<PasskeyVerificationResponse>(
      "/v1/auth/mfa/passkey/verify",
      {
        body: JSON.stringify(body),
        method: "POST",
      }
    );
  }

  async disablePasskey(input: {
    backupCode?: string;
    challenge?: string;
    credential?: PasskeyCredentialResponse;
  }): Promise<{ enabled: boolean }> {
    return this.request<{ enabled: boolean }>("/v1/auth/mfa/passkey/disable", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async verifyTotp(code: string): Promise<MfaTotpVerifyResponse> {
    return this.request<MfaTotpVerifyResponse>("/v1/auth/mfa/totp/verify", {
      body: JSON.stringify({ code }),
      method: "POST",
    });
  }

  async disableMfa(input: {
    backupCode?: string;
    code?: string;
  }): Promise<{ enabled: boolean }> {
    return this.request<{ enabled: boolean }>("/v1/auth/mfa/disable", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async acceptOrgInvite(
    request: AcceptOrgInviteRequest
  ): Promise<AcceptOrgInviteResponse> {
    const scopeRevision = this.orgScopeRevision;

    const response = await this.request<AcceptOrgInviteResponse>(
      "/v1/auth/accept-invite",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );

    if (scopeRevision === this.orgScopeRevision) {
      this.setOrgId(response.orgId);
    }

    return response;
  }

  async getMe(): Promise<AuthUserResponse> {
    const scopeRevision = this.orgScopeRevision;
    const response = await this.request<AuthUserResponse>("/v1/auth/me");
    const orgId = response.activeOrgId ?? response.orgId ?? null;

    if (scopeRevision === this.orgScopeRevision && orgId !== this.orgId) {
      this.applyAuthUserResponse(response);
    }

    return response;
  }

  async updateAuthProfile(
    request: UpdateAuthProfileRequest
  ): Promise<AuthUserResponse> {
    const scopeRevision = this.orgScopeRevision;

    const response = await this.request<AuthUserResponse>("/v1/auth/me", {
      body: JSON.stringify(request),
      method: "PATCH",
    });

    if (scopeRevision === this.orgScopeRevision) {
      this.applyAuthUserResponse(response);
    }

    return response;
  }

  async changePassword(request: ChangePasswordRequest): Promise<void> {
    await this.request("/v1/auth/change-password", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async requestPasswordReset(
    request: RequestPasswordResetRequest
  ): Promise<RequestPasswordResetResponse> {
    return this.request<RequestPasswordResetResponse>(
      "/v1/auth/password-reset/request",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async resetPassword(request: ResetPasswordRequest): Promise<void> {
    await this.request("/v1/auth/password-reset/complete", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listUserOrgs(): Promise<ListUserOrgsResponse> {
    return this.request<ListUserOrgsResponse>("/v1/auth/orgs");
  }

  async createUserOrganization(
    request: Pick<CreateOrganizationRequest, "name" | "slug">
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>("/v1/auth/orgs", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listBrowserSessions(): Promise<ListBrowserSessionsResponse> {
    return this.request<ListBrowserSessionsResponse>("/v1/auth/sessions");
  }

  async revokeBrowserSession(
    sessionId: string
  ): Promise<RevokeBrowserSessionsResponse> {
    return this.request<RevokeBrowserSessionsResponse>(
      `/v1/auth/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" }
    );
  }

  /** Platform admin only: ends every login session a user holds. */
  async revokeAllBrowserSessionsForUser(
    userId: string
  ): Promise<RevokeBrowserSessionsResponse> {
    return this.request<RevokeBrowserSessionsResponse>(
      `/v1/auth/users/${encodeURIComponent(userId)}/sessions`,
      { method: "DELETE" }
    );
  }

  async logout(): Promise<void> {
    await this.request("/v1/auth/logout", {
      method: "POST",
    });
  }

  async rotateLocalAuthToken(): Promise<RotateLocalAuthTokenResponse> {
    return this.request<RotateLocalAuthTokenResponse>(
      "/v1/auth/local-token/rotate",
      {
        method: "POST",
      }
    );
  }
}
