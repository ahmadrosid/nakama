import { randomBytes } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import {
  type AcceptOrgInviteResponse,
  type AuthUserResponse,
  type ChangePasswordRequest,
  type CreateOrganizationRequest,
  type CreateOrganizationResponse,
  type ListBrowserSessionsResponse,
  type ListUserOrgsResponse,
  LocalAuthTokenManagedExternallyError,
  type PasskeyCredentialResponse,
  type RequestPasswordResetRequest,
  type RequestPasswordResetResponse,
  type ResetPasswordRequest,
  type RevokeBrowserSessionsResponse,
  type RotateLocalAuthTokenResponse,
  rotateLocalAuthToken,
  type SetActiveOrgRequest,
  type SetupAuthRequest,
  type UpdateAuthProfileRequest,
} from "@nakama/core";
import { DEMO_LOGIN_EMAIL, DEMO_LOGIN_HOST } from "@nakama/core/demo-login";
import { ORG_ROLES } from "@nakama/db";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import {
  persistWebPublicUrl,
  resolveRequestClientOrigin,
} from "../../services/composio-callback-url";
import {
  ensureMfaEncryptionKey,
  getMfaEncryptionKey,
  loadMfaPolicy,
  updateMfaPolicy,
} from "../../services/mfa-config";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  findTotpStep,
  generateTotpSecret,
  hashBackupCode,
} from "../../services/mfa-crypto";
import type { ServerOptions } from "../context";
import {
  requirePlatformAdmin,
  requirePlatformAdminFromContext,
} from "../org-guards";
import {
  assertBrowserCsrf,
  assertJsonRequest,
  authenticateRequest,
  clearBrowserSessionCookies,
  createBrowserSessionResponse,
  errorResponse,
  getRequestAuth,
  json,
  readJson,
} from "../shared";
import type { HonoApp } from "../types";

/**
 * A real bcrypt hash at the cost the app uses, kept only so a login for an
 * unknown email costs the same as one for a known email.
 */
const ABSENT_ACCOUNT_PASSWORD_HASH =
  "$2b$10$IJnCe7uf5MN2/Vo89wb4ReF6yVI5SNnLdjIbiZ4Uwj4/r7zcqrWLm";
function passkeyVerificationErrorResponse(error: unknown, status: 400 | 401) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error("[passkey] verification failed", { error: detail });
  return errorResponse(
    process.env.NODE_ENV === "production"
      ? "Passkey verification failed."
      : `Passkey verification failed: ${detail}`,
    status
  );
}
function resolveWebAuthnContext(request: Request): {
  origin: string;
  rpID: string;
} {
  const origin =
    resolveRequestClientOrigin(request) ?? new URL(request.url).origin;
  return { origin, rpID: new URL(origin).hostname };
}

export function registerAuthRoutes(app: HonoApp, options: ServerOptions): void {
  const { authService, databaseAdapter, orgService } = options;
  const issueBackupCodes = async (
    userId: string,
    createdAt: string,
    replace = false
  ) => {
    if (!databaseAdapter) {
      return [];
    }
    if (
      !replace &&
      (await databaseAdapter.countUnusedMfaBackupCodes(userId)) > 0
    ) {
      return [];
    }
    const backupCodes: string[] = [];
    if (replace) {
      await databaseAdapter.deleteMfaBackupCodes(userId);
    }
    const mfaEncryptionKey = getMfaEncryptionKey();
    for (let index = 0; index < 10; index += 1) {
      const code = randomBytes(5).toString("hex").toUpperCase();
      backupCodes.push(code);
      await databaseAdapter.createMfaBackupCode({
        codeHash: hashBackupCode(code, mfaEncryptionKey),
        createdAt,
        id: crypto.randomUUID(),
        usedAt: null,
        userId,
      });
    }
    return backupCodes;
  };
  const clearBackupCodesIfNoFactors = async (userId: string) => {
    if (!databaseAdapter) {
      return;
    }
    const user = await databaseAdapter.getUserById(userId);
    const passkeys = await databaseAdapter.listPasskeys(userId);
    if (!user?.mfaEnabled && passkeys.length === 0) {
      await databaseAdapter.deleteMfaBackupCodes(userId);
    }
  };
  const authCredentialsSchema = z
    .object({
      backupCode: z.string().optional(),
      email: z.string(),
      mfaCode: z.string().optional(),
      passkey: z.record(z.string(), z.unknown()).optional(),
      passkeyChallenge: z.string().optional(),
      password: z.string().optional(),
    })
    .openapi("AuthCredentialsRequest");
  const authUserSchema = z
    .object({
      backupCodesEnabled: z.boolean().optional(),
      activeOrgId: z.string().nullable().optional(),
      email: z.string(),
      id: z.string(),
      isPlatformAdmin: z.boolean().optional(),
      passkeyEnabled: z.boolean().optional(),
      mfaEnabled: z.boolean().optional(),
      mfaEnrolled: z.boolean().optional(),
      mfaRequired: z.boolean().optional(),
      mode: z.enum(["api-key", "browser-session", "local-token"]).optional(),
      name: z.string().nullable().optional(),
      orgId: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .openapi("AuthUserResponse");
  const updateAuthProfileSchema = z
    .object({
      currentPassword: z.string().optional(),
      email: z.string().optional(),
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .openapi("UpdateAuthProfileRequest");
  const loggedOutSchema = z.object({
    ok: z.boolean(),
  });
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");

  const setupAuthSchema = z
    .object({
      admin: z.object({
        email: z.string(),
        name: z.string(),
        password: z.string(),
        phone: z.string().optional(),
      }),
      organization: z.object({
        name: z.string(),
        slug: z.string(),
      }),
      webPublicUrl: z.string().optional(),
    })
    .openapi("SetupAuthRequest");
  const createOrganizationSchema = z.object({
    admin: z
      .object({
        email: z.string(),
        name: z.string(),
        phone: z.string(),
      })
      .optional(),
    name: z.string(),
    slug: z.string(),
  });
  const setActiveOrgSchema = z.object({ orgId: z.string() });
  const setupRoute = createRoute({
    method: "post",
    operationId: "setupAuth",
    path: "/v1/auth/setup",
    request: {
      body: {
        content: {
          "application/json": { schema: setupAuthSchema },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Created admin user",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      409: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary:
      "Create the first organization, admin account, and browser session",
    tags: ["Auth"],
  });

  const loginRoute = createRoute({
    method: "post",
    operationId: "loginAuth",
    path: "/v1/auth/login",
    request: {
      body: {
        content: { "application/json": { schema: authCredentialsSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Logged in user",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Log in with email and password",
    tags: ["Auth"],
  });

  const meRoute = createRoute({
    method: "get",
    operationId: "getAuthMe",
    path: "/v1/auth/me",
    responses: {
      200: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Authenticated user",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Get the current authenticated user",
    tags: ["Auth"],
  });

  const updateMeRoute = createRoute({
    method: "patch",
    operationId: "updateAuthMe",
    path: "/v1/auth/me",
    request: {
      body: {
        content: { "application/json": { schema: updateAuthProfileSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Updated user",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      409: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Update the current user's profile",
    tags: ["Auth"],
  });

  const logoutRoute = createRoute({
    method: "post",
    operationId: "logoutAuth",
    path: "/v1/auth/logout",
    responses: {
      200: {
        content: { "application/json": { schema: loggedOutSchema } },
        description: "Logged out",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Log out and revoke the browser session",
    tags: ["Auth"],
  });

  const acceptInviteSchema = z
    .object({
      password: z.string().optional(),
      token: z.string(),
    })
    .openapi("AcceptOrgInviteRequest");
  const acceptInviteResponseSchema = z
    .object({
      email: z.string(),
      orgId: z.string(),
      role: z.enum(["admin", "member", "viewer"]),
    })
    .openapi("AcceptOrgInviteResponse");
  const changePasswordSchema = z
    .object({
      currentPassword: z.string(),
      newPassword: z.string(),
    })
    .openapi("ChangePasswordRequest");
  const requestPasswordResetSchema = z
    .object({ email: z.string() })
    .openapi("RequestPasswordResetRequest");
  const requestPasswordResetResponseSchema = z
    .object({
      delivered: z.boolean(),
      token: z.string().nullable(),
    })
    .openapi("RequestPasswordResetResponse");
  const resetPasswordSchema = z
    .object({
      newPassword: z.string(),
      token: z.string(),
    })
    .openapi("ResetPasswordRequest");
  const changePasswordRoute = createRoute({
    method: "post",
    operationId: "changePassword",
    path: "/v1/auth/change-password",
    request: {
      body: {
        content: { "application/json": { schema: changePasswordSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Password changed",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Change the current user's password",
    tags: ["Auth"],
  });
  const requestPasswordResetRoute = createRoute({
    method: "post",
    operationId: "requestPasswordReset",
    path: "/v1/auth/password-reset/request",
    request: {
      body: {
        content: {
          "application/json": { schema: requestPasswordResetSchema },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: requestPasswordResetResponseSchema },
        },
        description: "Password reset requested",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Request a password reset token",
    tags: ["Auth"],
  });
  const resetPasswordRoute = createRoute({
    method: "post",
    operationId: "resetPassword",
    path: "/v1/auth/password-reset/complete",
    request: {
      body: {
        content: { "application/json": { schema: resetPasswordSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Password reset",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Reset a password with a single-use token",
    tags: ["Auth"],
  });

  const acceptInviteRoute = createRoute({
    method: "post",
    operationId: "acceptOrgInvite",
    path: "/v1/auth/accept-invite",
    request: {
      body: {
        content: { "application/json": { schema: acceptInviteSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: acceptInviteResponseSchema } },
        description: "Invite accepted",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      404: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      409: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Accept an organization invite and create a browser session",
    tags: ["Auth"],
  });

  const rotateLocalAuthTokenSchema = z
    .object({ token: z.string() })
    .openapi("RotateLocalAuthTokenResponse");

  const rotateLocalAuthTokenRoute = createRoute({
    method: "post",
    operationId: "rotateLocalAuthToken",
    path: "/v1/auth/local-token/rotate",
    responses: {
      200: {
        content: { "application/json": { schema: rotateLocalAuthTokenSchema } },
        description: "Rotated local auth token",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Rotate the local API token used by CLI and channel workers",
    tags: ["Auth"],
  });

  app.openAPIRegistry.registerPath(setupRoute);
  app.post("/v1/auth/setup", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const humanUserCount = await databaseAdapter.countHumanUsers();
    if (humanUserCount > 0) {
      return errorResponse("Admin user already exists", 409);
    }

    const body = await readJson<SetupAuthRequest>(c.req.raw, setupAuthSchema);
    const password = body.admin?.password?.trim() ?? "";
    if (
      !(
        body.organization?.name?.trim() &&
        body.organization?.slug?.trim() &&
        body.admin?.name?.trim() &&
        body.admin?.email?.trim() &&
        password
      )
    ) {
      return errorResponse("Organization and admin details are required.", 400);
    }

    if (password.length < 8) {
      return errorResponse("Password must be at least 8 characters.", 400);
    }

    const webPublicUrl = resolveRequestClientOrigin(
      c.req.raw,
      body.webPublicUrl
    );
    if (webPublicUrl) {
      try {
        await persistWebPublicUrl(webPublicUrl);
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : String(error),
          400
        );
      }
    }

    const { user, organization } = await orgService.bootstrapInitialSetup({
      admin: {
        email: body.admin.email,
        name: body.admin.name,
        passwordHash: await authService.hashPassword(password),
        phone: body.admin.phone ?? "",
      },
      organization: {
        name: body.organization.name,
        slug: body.organization.slug,
      },
    });

    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      user,
      {
        activeOrgId: organization.id,
        request: c.req.raw,
      }
    );
    const authBody = await orgService.buildAuthUserResponse(
      user,
      response.session.id,
      organization.id
    );

    return json<AuthUserResponse>(authBody, 201, response.headers);
  });

  app.openAPIRegistry.registerPath(loginRoute);
  app.post("/v1/auth/login", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    assertJsonRequest(c.req.raw);

    const body = await readJson<{
      backupCode?: string;
      email: string;
      mfaCode?: string;
      passkey?: PasskeyCredentialResponse;
      passkeyChallenge?: string;
      password?: string;
    }>(c.req.raw, authCredentialsSchema);
    const passkeyLogin = Boolean(body.passkey && body.passkeyChallenge);
    let user = passkeyLogin
      ? null
      : await databaseAdapter.getUserByEmail(body.email);
    if (passkeyLogin) {
      const stored = body.passkey
        ? await databaseAdapter.getPasskeyByCredentialId(body.passkey.id)
        : null;
      if (stored) {
        user = await databaseAdapter.getUserById(stored.userId);
      }
    }
    if (!user) {
      if (!passkeyLogin) {
        // Spend the same bcrypt work an existing account would, so the response
        // time stops answering "does this email have an account here".
        await authService.verifyPassword(
          body.password?.trim() ?? "",
          ABSENT_ACCOUNT_PASSWORD_HASH
        );
      }
      return errorResponse(
        passkeyLogin ? "Passkey verification failed." : "Invalid credentials",
        401
      );
    }

    if (!passkeyLogin) {
      // Every path that sets a password trims it first, so login has to as well
      // or a padded password can never be typed back in.
      const valid = await authService.verifyPassword(
        body.password?.trim() ?? "",
        user.passwordHash
      );
      if (!valid) {
        return errorResponse("Invalid credentials", 401);
      }
    }

    if (user.disabledAt) {
      return errorResponse("Account disabled", 403);
    }

    const passkeys = await databaseAdapter.listPasskeys(user.id);
    if (passkeyLogin) {
      const stored = body.passkey
        ? await databaseAdapter.getPasskey(user.id, body.passkey.id)
        : null;
      if (!(stored && body.passkeyChallenge)) {
        return errorResponse("Passkey verification failed.", 401);
      }
      const { origin, rpID } = resolveWebAuthnContext(c.req.raw);
      let validPasskey = false;
      try {
        const verification = await verifyAuthenticationResponse({
          credential: {
            counter: stored.counter,
            id: stored.credentialId,
            publicKey: Buffer.from(stored.publicKey, "base64url"),
            transports: stored.transports,
          },
          expectedChallenge: body.passkeyChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          response: body.passkey as unknown as AuthenticationResponseJSON,
        });
        if (verification.verified) {
          validPasskey = await databaseAdapter.consumePasskeyChallenge(
            body.passkeyChallenge,
            user.id,
            "authentication",
            new Date().toISOString()
          );
          if (validPasskey) {
            await databaseAdapter.updatePasskeyCounter(
              user.id,
              stored.credentialId,
              verification.authenticationInfo.newCounter
            );
          }
        }
      } catch (error) {
        return passkeyVerificationErrorResponse(error, 401);
      }
      if (!validPasskey) {
        return errorResponse("Passkey verification failed.", 401);
      }
    } else if (passkeys.length > 0 && !(body.mfaCode || body.backupCode)) {
      return errorResponse("Passkey verification required.", 401, {
        totpEnabled: Boolean(user.mfaEnabled && user.mfaTotpSecretEnc),
      });
    }
    let validMfa = false;
    if (!passkeyLogin && (user.mfaEnabled || passkeys.length > 0)) {
      if (user.mfaTotpSecretEnc && body.mfaCode) {
        try {
          const step = findTotpStep(
            decryptTotpSecret(user.mfaTotpSecretEnc),
            body.mfaCode
          );
          validMfa =
            step !== null &&
            (await databaseAdapter.consumeMfaTotpStep(user.id, step));
        } catch {
          validMfa = false;
        }
      }
      if (!validMfa && body.backupCode) {
        const mfaEncryptionKey = getMfaEncryptionKey();
        validMfa = await databaseAdapter.consumeMfaBackupCode(
          user.id,
          hashBackupCode(body.backupCode, mfaEncryptionKey),
          new Date().toISOString()
        );
      }
    }
    if (
      !passkeyLogin &&
      (passkeys.length > 0 || user.mfaEnabled) &&
      !validMfa
    ) {
      return errorResponse(
        body.backupCode
          ? "Backup code is invalid or has already been used."
          : "MFA verification required.",
        401
      );
    }

    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      user,
      {
        request: c.req.raw,
      }
    );
    const authBody = await orgService.buildAuthUserResponse(
      user,
      response.session.id,
      response.session.activeOrgId
    );
    return json<AuthUserResponse>(authBody, 200, response.headers);
  });
  app.post("/v1/auth/mfa/backup-codes", async (c) => {
    if (!(authService && databaseAdapter)) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    if (!auth.user) {
      return errorResponse("Authentication required", 401);
    }
    assertBrowserCsrf(c.req.raw, auth, authService);
    const body = await readJson<{
      mfaCode?: string;
      passkey?: PasskeyCredentialResponse;
      passkeyChallenge?: string;
    }>(
      c.req.raw,
      z.object({
        mfaCode: z.string().trim().min(6).max(8).optional(),
        passkey: z.record(z.string(), z.unknown()).optional(),
        passkeyChallenge: z.string().optional(),
      })
    );
    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return errorResponse("Authentication required", 401);
    }
    const passkeys = await databaseAdapter.listPasskeys(user.id);
    let authorized = false;
    if (body.passkey && body.passkeyChallenge && passkeys.length > 0) {
      const stored = await databaseAdapter.getPasskey(user.id, body.passkey.id);
      if (stored) {
        try {
          const { origin, rpID } = resolveWebAuthnContext(c.req.raw);
          const verification = await verifyAuthenticationResponse({
            credential: {
              counter: stored.counter,
              id: stored.credentialId,
              publicKey: Buffer.from(stored.publicKey, "base64url"),
              transports: stored.transports,
            },
            expectedChallenge: body.passkeyChallenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            response: body.passkey as unknown as AuthenticationResponseJSON,
          });
          if (verification.verified) {
            authorized = await databaseAdapter.consumePasskeyChallenge(
              body.passkeyChallenge,
              user.id,
              "authentication",
              new Date().toISOString()
            );
            if (authorized) {
              await databaseAdapter.updatePasskeyCounter(
                user.id,
                stored.credentialId,
                verification.authenticationInfo.newCounter
              );
            }
          }
        } catch {
          authorized = false;
        }
      }
    } else if (body.mfaCode && user.mfaEnabled && user.mfaTotpSecretEnc) {
      try {
        const step = findTotpStep(
          decryptTotpSecret(user.mfaTotpSecretEnc),
          body.mfaCode
        );
        authorized =
          step !== null &&
          (await databaseAdapter.consumeMfaTotpStep(user.id, step));
      } catch {
        authorized = false;
      }
    }
    if (!authorized) {
      return errorResponse("Reauthentication required.", 401);
    }
    return json({
      backupCodes: await issueBackupCodes(
        user.id,
        new Date().toISOString(),
        true
      ),
    });
  });

  app.get("/v1/settings/mfa", async (c) => {
    if (!getRequestAuth(c).user) {
      return errorResponse("Authentication required", 401);
    }
    return json(await loadMfaPolicy());
  });

  app.post("/v1/auth/passkey/login/options", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }
    assertJsonRequest(c.req.raw);
    const auth = c.get("auth");
    const user = auth?.user
      ? await databaseAdapter.getUserById(auth.user.id)
      : null;
    if (auth?.user) {
      if (!authService) {
        return errorResponse("Authentication not configured", 500);
      }
      assertBrowserCsrf(c.req.raw, auth, authService);
    }

    if (user) {
      if (user.disabledAt) {
        return errorResponse("Account disabled", 403);
      }
      const passkeys = await databaseAdapter.listPasskeys(user.id);
      if (passkeys.length === 0) {
        return errorResponse("Passkey verification failed.", 401);
      }
      const { rpID } = resolveWebAuthnContext(c.req.raw);
      const options = await generateAuthenticationOptions({
        allowCredentials: passkeys.map((passkey) => ({
          id: passkey.credentialId,
          transports: passkey.transports,
        })),
        rpID,
        userVerification: "preferred",
      });
      await databaseAdapter.createPasskeyChallenge({
        challenge: options.challenge,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        type: "authentication",
        userId: user.id,
      });
      return json({ challenge: options.challenge, options });
    }

    const { rpID } = resolveWebAuthnContext(c.req.raw);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
    });
    await databaseAdapter.createPasskeyChallenge({
      challenge: options.challenge,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      type: "authentication",
      userId: null,
    });
    return json({ challenge: options.challenge, options });
  });

  app.post("/v1/auth/mfa/passkey/start", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);
    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return errorResponse("Authentication required", 401);
    }
    const policy = await loadMfaPolicy();
    if (!policy.enabled) {
      return errorResponse("MFA is not enabled.", 400);
    }
    const { rpID } = resolveWebAuthnContext(c.req.raw);
    const options = await generateRegistrationOptions({
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
      excludeCredentials: (await databaseAdapter.listPasskeys(user.id)).map(
        (passkey) => ({
          id: passkey.credentialId,
          transports: passkey.transports,
        })
      ),
      rpID,
      rpName: "Nakama",
      userDisplayName: user.name ?? user.email,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
    });
    await databaseAdapter.createPasskeyChallenge({
      challenge: options.challenge,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      type: "registration",
      userId: user.id,
    });
    return json({
      challenge: options.challenge,
      options,
    });
  });

  app.post("/v1/auth/mfa/passkey/verify", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);
    const body = await readJson<{
      challenge: string;
      credential: PasskeyCredentialResponse;
      name?: string;
    }>(
      c.req.raw,
      z.object({
        challenge: z.string().min(1),
        credential: z.record(z.string(), z.unknown()),
        name: z.string().trim().min(1).max(100).optional(),
      })
    );
    const { origin, rpID } = resolveWebAuthnContext(c.req.raw);
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        expectedChallenge: body.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        response: body.credential as unknown as RegistrationResponseJSON,
      });
    } catch (error) {
      return passkeyVerificationErrorResponse(error, 400);
    }
    if (!verification.verified) {
      return errorResponse("Passkey verification failed.", 400);
    }
    const consumed = await databaseAdapter.consumePasskeyChallenge(
      body.challenge,
      auth.user.id,
      "registration",
      new Date().toISOString()
    );
    if (!consumed) {
      return errorResponse("Passkey setup has expired.", 400);
    }
    const credential = verification.registrationInfo.credential;
    try {
      await databaseAdapter.createPasskey({
        counter: credential.counter,
        createdAt: new Date().toISOString(),
        credentialId: credential.id,
        id: crypto.randomUUID(),
        name: body.name ?? "Passkey",
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        transports: credential.transports ?? [],
        userId: auth.user.id,
      });
    } catch {
      return errorResponse("Passkey is already registered.", 409);
    }
    const backupCodes = await issueBackupCodes(
      auth.user.id,
      new Date().toISOString()
    );
    return json({ backupCodes, enabled: true });
  });

  app.post("/v1/auth/mfa/passkey/disable", async (c) => {
    if (!(authService && databaseAdapter)) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);
    const body = await readJson<{
      backupCode?: string;
      challenge?: string;
      credential?: PasskeyCredentialResponse;
    }>(
      c.req.raw,
      z
        .object({
          backupCode: z.string().trim().min(1).optional(),
          challenge: z.string().optional(),
          credential: z.record(z.string(), z.unknown()).optional(),
        })
        .refine(
          ({ backupCode, challenge, credential }) =>
            Boolean(backupCode) || Boolean(challenge && credential),
          "Provide a passkey or backup code."
        )
    );
    const user = await databaseAdapter.getUserById(auth.user.id);
    let authorized = false;
    if (body.backupCode && user) {
      authorized = await databaseAdapter.consumeMfaBackupCode(
        user.id,
        hashBackupCode(body.backupCode, getMfaEncryptionKey()),
        new Date().toISOString()
      );
    } else if (body.challenge && body.credential && user) {
      const stored = await databaseAdapter.getPasskey(
        user.id,
        body.credential.id
      );
      if (stored) {
        const { origin, rpID } = resolveWebAuthnContext(c.req.raw);
        try {
          const verification = await verifyAuthenticationResponse({
            credential: {
              counter: stored.counter,
              id: stored.credentialId,
              publicKey: Buffer.from(stored.publicKey, "base64url"),
              transports: stored.transports,
            },
            expectedChallenge: body.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            response: body.credential as unknown as AuthenticationResponseJSON,
          });
          if (verification.verified) {
            authorized = await databaseAdapter.consumePasskeyChallenge(
              body.challenge,
              user.id,
              "authentication",
              new Date().toISOString()
            );
            if (authorized) {
              await databaseAdapter.updatePasskeyCounter(
                user.id,
                stored.credentialId,
                verification.authenticationInfo.newCounter
              );
            }
          }
        } catch (error) {
          return passkeyVerificationErrorResponse(error, 401);
        }
      }
    }
    if (!authorized) {
      return errorResponse("Reauthentication required.", 401);
    }
    await databaseAdapter.deletePasskeys(auth.user.id);
    await clearBackupCodesIfNoFactors(auth.user.id);
    return json({ enabled: false });
  });

  app.put("/v1/settings/mfa", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    if (
      new URL(c.req.url).hostname.toLowerCase() === DEMO_LOGIN_HOST ||
      auth.user.email.toLowerCase() === DEMO_LOGIN_EMAIL
    ) {
      return errorResponse("MFA policy is not available in the demo.", 403);
    }
    const body = await readJson<{
      enabled?: boolean;
      enforcedRoles?: Array<"admin" | "member" | "viewer">;
      required?: boolean;
    }>(
      c.req.raw,
      z.object({
        enabled: z.boolean().optional(),
        enforcedRoles: z.array(z.enum(ORG_ROLES)).min(1).optional(),
        required: z.boolean().optional(),
      })
    );
    const current = await loadMfaPolicy();
    if (body.enabled === true && !current.keyConfigured) {
      await ensureMfaEncryptionKey();
    }
    if (body.required === true && (body.enabled ?? current.enabled) !== true) {
      return errorResponse(
        "MFA must be enabled before it can be enforced.",
        400
      );
    }
    return json(
      await updateMfaPolicy({
        enabled: body.enabled,
        enforcedRoles: body.enforcedRoles,
        required: body.required,
      })
    );
  });

  app.post("/v1/auth/mfa/totp/start", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    if (!auth.user) {
      return errorResponse("Authentication required", 401);
    }
    if (auth.mode !== "browser-session") {
      return errorResponse("Browser session required", 403);
    }
    assertBrowserCsrf(c.req.raw, auth, authService);
    const policy = await loadMfaPolicy();
    if (!(policy.enabled && policy.keyConfigured)) {
      return errorResponse("MFA is not enabled.", 400);
    }
    const secret = generateTotpSecret();
    await databaseAdapter.setPendingMfaSecret(
      auth.user.id,
      encryptTotpSecret(secret),
      new Date().toISOString()
    );
    const account = encodeURIComponent(auth.user.email);
    return json({
      secret,
      uri: `otpauth://totp/Nakama:${account}?secret=${secret}&issuer=Nakama&algorithm=SHA1&digits=6&period=30`,
    });
  });

  app.post("/v1/auth/mfa/totp/verify", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    if (!auth.user) {
      return errorResponse("Authentication required", 401);
    }
    if (auth.mode !== "browser-session") {
      return errorResponse("Browser session required", 403);
    }
    assertBrowserCsrf(c.req.raw, auth, authService);
    const body = await readJson<{ code: string }>(
      c.req.raw,
      z.object({ code: z.string().min(6).max(8) })
    );
    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user?.mfaTotpPendingSecretEnc) {
      return errorResponse("MFA setup has not started.", 400);
    }
    let step: number | null = null;
    try {
      step = findTotpStep(
        decryptTotpSecret(user.mfaTotpPendingSecretEnc),
        body.code
      );
    } catch {
      step = null;
    }
    if (step === null) {
      return errorResponse("Invalid MFA code.", 400);
    }
    const now = new Date().toISOString();
    const activated = await databaseAdapter.activateUserMfa(
      auth.user.id,
      user.mfaTotpPendingSecretEnc,
      step,
      now
    );
    if (!activated) {
      return errorResponse("MFA setup has already been completed.", 400);
    }
    const backupCodes = await issueBackupCodes(auth.user.id, now);
    return json({ backupCodes, enabled: true });
  });

  app.post("/v1/auth/mfa/disable", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }
    const auth = getRequestAuth(c);
    if (!auth.user) {
      return errorResponse("Authentication required", 401);
    }
    if (auth.mode !== "browser-session") {
      return errorResponse("Browser session required", 403);
    }
    assertBrowserCsrf(c.req.raw, auth, authService);
    const body = await readJson<{ backupCode?: string; code?: string }>(
      c.req.raw,
      z
        .object({
          backupCode: z.string().trim().min(1).optional(),
          code: z.string().trim().min(6).max(8).optional(),
        })
        .refine(
          ({ backupCode, code }) => Boolean(backupCode) !== Boolean(code),
          "Provide a TOTP or backup code."
        )
    );
    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user?.mfaEnabled) {
      return errorResponse("MFA is not enabled.", 400);
    }

    let valid = false;
    if (body.backupCode) {
      valid = await databaseAdapter.consumeMfaBackupCode(
        user.id,
        hashBackupCode(body.backupCode, getMfaEncryptionKey()),
        new Date().toISOString()
      );
    } else if (user.mfaTotpSecretEnc) {
      try {
        const step = findTotpStep(
          decryptTotpSecret(user.mfaTotpSecretEnc),
          body.code ?? ""
        );
        valid =
          step !== null &&
          (await databaseAdapter.consumeMfaTotpStep(user.id, step));
      } catch {
        valid = false;
      }
    }
    if (!valid) {
      return errorResponse(
        body.backupCode
          ? "Backup code is invalid or has already been used."
          : "Invalid MFA code.",
        401
      );
    }

    await databaseAdapter.updateUserMfa(
      user.id,
      {
        enabled: false,
        mfaTotpLastStep: null,
        pendingTotpSecretEnc: null,
        totpSecretEnc: null,
      },
      new Date().toISOString()
    );
    await clearBackupCodesIfNoFactors(auth.user.id);
    return json({ enabled: false });
  });
  app.openapi(meRoute, async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    if (!auth) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const authBody = await orgService.buildAuthUserResponse(
      user,
      auth.session?.id,
      auth.session?.activeOrgId ?? auth.activeOrgId
    );
    // The builder answers from the user record, which describes whoever created
    // the credential. An API key is de-privileged whatever its owner is, and the
    // guards already read that, so reporting the owner's flag here told an
    // operator the opposite of what every admin route would do.
    return c.json(
      {
        ...authBody,
        isPlatformAdmin: auth.isPlatformAdmin,
        mode: auth.mode,
      },
      200
    );
  });

  app.openAPIRegistry.registerPath(updateMeRoute);
  app.patch("/v1/auth/me", async (c) => {
    if (!(authService && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<UpdateAuthProfileRequest>(
      c.req.raw,
      updateAuthProfileSchema
    );
    const updated = await orgService.updateOwnProfile(auth.user.id, body);
    return json<AuthUserResponse>(updated);
  });

  app.openapi(logoutRoute, async (c) => {
    if (!(authService && databaseAdapter)) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    if (!auth) {
      return c.json({ error: "Authentication required" }, 401);
    }

    assertBrowserCsrf(c.req.raw, auth, authService);

    if (auth.mode === "browser-session" && auth.session) {
      const revokedAt = new Date().toISOString();
      await databaseAdapter.revokeBrowserSessionBySessionTokenHash(
        auth.session.sessionTokenHash,
        revokedAt
      );
    }

    const response = c.json({ ok: true }, 200);
    clearBrowserSessionCookies(response.headers);
    return response;
  });

  app.openAPIRegistry.registerPath(changePasswordRoute);
  app.post("/v1/auth/change-password", async (c) => {
    if (!(authService && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<ChangePasswordRequest>(
      c.req.raw,
      changePasswordSchema
    );
    await orgService.changePassword({
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      userId: auth.user.id,
    });

    const response = c.json({ ok: true }, 200);
    clearBrowserSessionCookies(response.headers);
    return response;
  });

  app.openAPIRegistry.registerPath(requestPasswordResetRoute);
  app.post("/v1/auth/password-reset/request", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const body = await readJson<RequestPasswordResetRequest>(
      c.req.raw,
      requestPasswordResetSchema
    );
    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    const allowManualToken = auth?.isPlatformAdmin === true;
    if (allowManualToken && auth) {
      assertBrowserCsrf(c.req.raw, auth, authService);
    }
    return json<RequestPasswordResetResponse>(
      await orgService.requestPasswordReset(body.email, allowManualToken)
    );
  });

  app.openAPIRegistry.registerPath(resetPasswordRoute);
  app.post("/v1/auth/password-reset/complete", async (c) => {
    if (!orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const body = await readJson<ResetPasswordRequest>(
      c.req.raw,
      resetPasswordSchema
    );
    await orgService.resetPassword(body);
    return c.json({ ok: true }, 200);
  });

  app.openAPIRegistry.registerPath(acceptInviteRoute);
  app.post("/v1/auth/accept-invite", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    assertJsonRequest(c.req.raw);

    const body = await readJson<{ token: string; password?: string }>(
      c.req.raw,
      acceptInviteSchema
    );
    const accepted = await orgService.acceptInvite(body);
    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      accepted.user,
      { activeOrgId: accepted.orgId, request: c.req.raw }
    );

    return json<AcceptOrgInviteResponse>(
      {
        email: accepted.user.email,
        orgId: accepted.orgId,
        role: accepted.role,
      },
      200,
      response.headers
    );
  });

  app.openAPIRegistry.registerPath(rotateLocalAuthTokenRoute);
  app.post("/v1/auth/local-token/rotate", async (c) => {
    if (!(authService && databaseAdapter)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    if (!auth) {
      return errorResponse("Authentication required", 401);
    }

    if (auth.mode !== "browser-session") {
      return errorResponse(
        "Sign in through the dashboard to rotate the local auth token.",
        403
      );
    }

    requirePlatformAdmin(auth);
    assertBrowserCsrf(c.req.raw, auth, authService);

    try {
      const token = await rotateLocalAuthToken();
      return json<RotateLocalAuthTokenResponse>({ token }, 200);
    } catch (error) {
      if (error instanceof LocalAuthTokenManagedExternallyError) {
        return errorResponse(error.message, 400);
      }

      throw error;
    }
  });

  app.get("/v1/auth/orgs", async (c) => {
    if (!orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    const orgs = await orgService.listUserOrgs(
      auth.user.id,
      auth.mode === "api-key" ? (auth.activeOrgId ?? null) : undefined
    );
    return json<ListUserOrgsResponse>(orgs);
  });

  app.post("/v1/auth/orgs", async (c) => {
    if (!(authService && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = requirePlatformAdminFromContext(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<CreateOrganizationRequest>(
      c.req.raw,
      createOrganizationSchema
    );
    const result = await orgService.createOrganization(body, auth.user.id);
    return json<CreateOrganizationResponse>(result, 201);
  });

  app.post("/v1/auth/active-org", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<SetActiveOrgRequest>(
      c.req.raw,
      setActiveOrgSchema
    );
    await orgService.setActiveOrg({
      orgId: body.orgId,
      sessionId: auth.session?.id,
      userId: auth.user.id,
    });

    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return errorResponse("Authentication required", 401);
    }

    const authBody = await orgService.buildAuthUserResponse(
      user,
      auth.session?.id,
      body.orgId
    );
    return json<AuthUserResponse>(authBody);
  });
  app.get("/v1/auth/sessions", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    if (auth.mode !== "browser-session") {
      return errorResponse("Browser session authentication required", 403);
    }
    const records = await databaseAdapter.listBrowserSessionsForUser(
      auth.user.id,
      new Date().toISOString()
    );

    return json<ListBrowserSessionsResponse>({
      sessions: records.map((record) => ({
        createdAt: record.createdAt,
        current: record.id === auth.session?.id,
        expiresAt: record.expiresAt,
        id: record.id,
        lastUsedAt: record.lastUsedAt,
      })),
    });
  });

  app.delete("/v1/auth/sessions/:sessionId", async (c) => {
    if (!(authService && databaseAdapter)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    if (auth.mode !== "browser-session") {
      return errorResponse("Browser session authentication required", 403);
    }
    assertBrowserCsrf(c.req.raw, auth, authService);

    const sessionId = c.req.param("sessionId");
    const revoked = await databaseAdapter.revokeBrowserSessionForUser(
      sessionId,
      auth.user.id,
      new Date().toISOString()
    );

    // A session that is not yours and a session that is not there answer the
    // same, so an id cannot be tested against another account.
    if (!revoked) {
      return errorResponse("Session not found", 404);
    }

    const response = json<RevokeBrowserSessionsResponse>({ revoked: 1 });
    // Revoking the session you are on leaves the browser holding a cookie that
    // no longer authenticates, which reads as a broken app until a reload.
    if (sessionId === auth.session?.id) {
      clearBrowserSessionCookies(response.headers);
    }
    return response;
  });

  app.delete("/v1/auth/users/:userId/sessions", async (c) => {
    if (!(authService && databaseAdapter)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);
    requirePlatformAdmin(auth);

    const userId = c.req.param("userId");
    const user = await databaseAdapter.getUserById(userId);
    if (!user) {
      return errorResponse("User not found", 404);
    }

    const revoked = await databaseAdapter.revokeBrowserSessionsForUser(
      userId,
      new Date().toISOString()
    );

    const response = json<RevokeBrowserSessionsResponse>({ revoked });
    // A platform admin revoking their own sessions is the breach-containment
    // case, and it has to log them out here too.
    if (userId === auth.user.id) {
      clearBrowserSessionCookies(response.headers);
    }
    return response;
  });
}
