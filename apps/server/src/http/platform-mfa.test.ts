import { expect, test } from "bun:test";
import { loadLocalAuthToken } from "@nakama/core";
import { DEMO_LOGIN_HOST } from "@nakama/core/demo-login";
import { getMfaEncryptionKey } from "../services/mfa-config";
import {
  createTotpCode,
  encryptTotpSecret,
  generateTotpSecret,
  hashBackupCode,
} from "../services/mfa-crypto";
import { setupTestConfigDir } from "../test-config-dir";
import { createMinimalHonoApp } from "./test-app-helpers";
import { seedLocalClientUser, seedOrgForUser } from "./test-org-helpers";
import type { AppFetch } from "./test-session-helpers";
import {
  browserSessionFromResponse,
  loginPlatformAdminSession,
  setupFreshInstallSession,
} from "./test-session-helpers";

setupTestConfigDir("nakama-platform-mfa-test-");

test("platform admin configures MFA and login requires the user's TOTP", async () => {
  const { app, authService, databaseAdapter } = createMinimalHonoApp();
  const session = await setupFreshInstallSession(
    app as AppFetch,
    databaseAdapter
  );

  const policyResponse = await app.fetch(
    new Request("http://localhost:4310/v1/settings/mfa", {
      body: JSON.stringify({ enabled: true, required: true }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "PUT",
    })
  );
  expect(policyResponse.status).toBe(200);
  expect(await policyResponse.json()).toMatchObject({
    enabled: true,
    enforcedRoles: ["admin", "member", "viewer"],
    keyConfigured: true,
    required: true,
  });
  const demoPolicyResponse = await app.fetch(
    new Request(`http://${DEMO_LOGIN_HOST}/v1/settings/mfa`, {
      body: JSON.stringify({ enabled: false }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "PUT",
    })
  );
  expect(demoPolicyResponse.status).toBe(403);

  const user = await databaseAdapter.getUserByEmail("admin@example.com");
  if (!user) {
    throw new Error("Expected setup user");
  }

  const unenrolledLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(unenrolledLogin.status).toBe(200);
  expect(await unenrolledLogin.json()).toMatchObject({
    mfaEnrolled: false,
    mfaRequired: true,
  });
  const platformSession = await loginPlatformAdminSession(
    app as AppFetch,
    authService,
    databaseAdapter
  );

  const memberOnlyPolicy = await app.fetch(
    new Request("http://localhost:4310/v1/settings/mfa", {
      body: JSON.stringify({ enforcedRoles: ["member"] }),
      headers: platformSession.headers(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        },
        session.orgId
      ),
      method: "PUT",
    })
  );
  expect(memberOnlyPolicy.status).toBe(200);
  const memberOnlyLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(await memberOnlyLogin.json()).toMatchObject({
    mfaRequired: false,
  });
  const adminOnlyPolicy = await app.fetch(
    new Request("http://localhost:4310/v1/settings/mfa", {
      body: JSON.stringify({ enforcedRoles: ["admin"] }),
      headers: platformSession.headers(
        {
          "Content-Type": "application/json",
          "X-CSRF-Token": platformSession.csrfToken,
        },
        session.orgId
      ),
      method: "PUT",
    })
  );
  expect(adminOnlyPolicy.status).toBe(200);
  const secret = generateTotpSecret();

  await databaseAdapter.updateUserMfa(
    user.id,
    {
      enabled: true,
      mfaTotpLastStep: null,
      pendingTotpSecretEnc: null,
      totpSecretEnc: encryptTotpSecret(secret),
    },
    new Date().toISOString()
  );
  const mfaEncryptionKey = getMfaEncryptionKey();
  await databaseAdapter.createMfaBackupCode({
    codeHash: hashBackupCode("BACKUP-123", mfaEncryptionKey),
    createdAt: new Date().toISOString(),
    id: "backup-123",
    usedAt: null,
    userId: user.id,
  });

  const missingCode = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(missingCode.status).toBe(401);

  const validCode = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        mfaCode: createTotpCode(secret),
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(validCode.status).toBe(200);
  const replayedCode = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        mfaCode: createTotpCode(secret),
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(replayedCode.status).toBe(401);
  const backupLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        backupCode: "BACKUP-123",
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(backupLogin.status).toBe(200);
  const reusedBackupLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        backupCode: "BACKUP-123",
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(reusedBackupLogin.status).toBe(401);
  expect(await reusedBackupLogin.json()).toMatchObject({
    error: "Backup code is invalid or has already been used.",
  });
  await databaseAdapter.createMfaBackupCode({
    codeHash: hashBackupCode("DISABLE-BACKUP", mfaEncryptionKey),
    createdAt: new Date().toISOString(),
    id: "disable-backup",
    usedAt: null,
    userId: user.id,
  });
  await databaseAdapter.createMfaBackupCode({
    codeHash: hashBackupCode("STALE-BACKUP", mfaEncryptionKey),
    createdAt: new Date().toISOString(),
    id: "stale-backup",
    usedAt: null,
    userId: user.id,
  });

  const disableResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/disable", {
      body: JSON.stringify({ backupCode: "DISABLE-BACKUP" }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(disableResponse.status).toBe(200);
  expect(
    await databaseAdapter.consumeMfaBackupCode(
      user.id,
      hashBackupCode("STALE-BACKUP", mfaEncryptionKey),
      new Date().toISOString()
    )
  ).toBe(false);

  const startResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/start", {
      headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
      method: "POST",
    })
  );
  expect(startResponse.status).toBe(200);
  const startBody = (await startResponse.json()) as { secret: string };
  const pendingUser = await databaseAdapter.getUserById(user.id);
  expect(pendingUser?.mfaTotpSecretEnc).toBeNull();
  expect(pendingUser?.mfaTotpPendingSecretEnc).toBeTruthy();

  const verifyResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/verify", {
      body: JSON.stringify({ code: createTotpCode(startBody.secret) }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(verifyResponse.status).toBe(200);
  const enrolledUser = await databaseAdapter.getUserById(user.id);
  expect(enrolledUser?.mfaTotpSecretEnc).toBeTruthy();
  expect(enrolledUser?.mfaTotpPendingSecretEnc).toBeNull();
  const verifyBody = (await verifyResponse.json()) as { backupCodes: string[] };

  const staleBackupLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        backupCode: "STALE-BACKUP",
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(staleBackupLogin.status).toBe(401);
  expect(await staleBackupLogin.json()).toMatchObject({
    error: "Backup code is invalid or has already been used.",
  });
  const disableWithBackupResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/disable", {
      body: JSON.stringify({ backupCode: verifyBody.backupCodes[0] }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(disableWithBackupResponse.status).toBe(200);
});

test("blocks API keys from mutating browser MFA enrollment", async () => {
  const { app, authService, databaseAdapter } = createMinimalHonoApp();
  const setupSession = await setupFreshInstallSession(
    app as AppFetch,
    databaseAdapter
  );
  const orgId = setupSession.orgId;
  if (!orgId) {
    throw new Error("Expected setup organization");
  }

  const policyResponse = await app.fetch(
    new Request("http://localhost:4310/v1/settings/mfa", {
      body: JSON.stringify({ enabled: true, required: true }),
      headers: setupSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": setupSession.csrfToken,
      }),
      method: "PUT",
    })
  );
  expect(policyResponse.status).toBe(200);

  const user = await databaseAdapter.getUserByEmail("admin@example.com");
  if (!user) {
    throw new Error("Expected setup user");
  }

  const apiKey = `nk_live_${"d".repeat(64)}`;
  await databaseAdapter.createApiKey({
    createdAt: new Date().toISOString(),
    createdByUserId: user.id,
    environment: "live",
    expiresAt: null,
    id: "pending-mfa-api-key",
    keyPrefix: apiKey.slice(0, 20),
    lastUsedAt: null,
    name: "Pending MFA test key",
    orgId,
    revokedAt: null,
    secretHash: authService.hashToken(apiKey),
  });

  const loginResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(loginResponse.status).toBe(200);
  expect(await loginResponse.json()).toMatchObject({
    mfaEnrolled: false,
    mfaRequired: true,
  });
  const pendingSession = browserSessionFromResponse(loginResponse, orgId);

  const blockedProfiles = await app.fetch(
    new Request("http://localhost:4310/v1/profiles", {
      headers: pendingSession.headers(),
    })
  );
  expect(blockedProfiles.status).toBe(403);

  const blockedApiKeyMint = await app.fetch(
    new Request(`http://localhost:4310/v1/orgs/${orgId}/api-keys`, {
      body: JSON.stringify({ name: "should-not-exist" }),
      headers: pendingSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": pendingSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(blockedApiKeyMint.status).toBe(403);

  const policyRead = await app.fetch(
    new Request("http://localhost:4310/v1/settings/mfa", {
      headers: pendingSession.headers(),
    })
  );
  expect(policyRead.status).toBe(200);

  const apiKeyProfiles = await app.fetch(
    new Request("http://localhost:4310/v1/profiles", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  );
  expect(apiKeyProfiles.status).toBe(200);

  await seedLocalClientUser(databaseAdapter);
  const localToken = await loadLocalAuthToken();
  if (!localToken) {
    throw new Error("Expected local auth token");
  }
  await seedOrgForUser(databaseAdapter, "local-client@nakama.internal", orgId);
  const localTokenProfiles = await app.fetch(
    new Request("http://localhost:4310/v1/profiles", {
      headers: { Authorization: `Bearer ${localToken}`, "X-Org-Id": orgId },
    })
  );
  expect(localTokenProfiles.status).toBe(200);

  const logoutLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "admin@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  const logoutSession = browserSessionFromResponse(logoutLogin, orgId);
  const logoutResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/logout", {
      headers: logoutSession.headers({
        "X-CSRF-Token": logoutSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(logoutResponse.status).toBe(200);
  const apiKeyStart = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/start", {
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
    })
  );
  expect(apiKeyStart.status).toBe(403);

  const startResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/start", {
      headers: pendingSession.headers({
        "X-CSRF-Token": pendingSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(startResponse.status).toBe(200);
  const startBody = (await startResponse.json()) as { secret: string };
  const apiKeyVerify = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/verify", {
      body: JSON.stringify({ code: "000000" }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    })
  );
  expect(apiKeyVerify.status).toBe(403);

  const verifyResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/verify", {
      body: JSON.stringify({ code: createTotpCode(startBody.secret) }),
      headers: pendingSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": pendingSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(verifyResponse.status).toBe(200);
  const apiKeyDisable = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/disable", {
      body: JSON.stringify({ backupCode: "API-KEY-MUST-NOT-DISABLE" }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    })
  );
  expect(apiKeyDisable.status).toBe(403);

  const unblockedProfiles = await app.fetch(
    new Request("http://localhost:4310/v1/profiles", {
      headers: pendingSession.headers(),
    })
  );
  expect(unblockedProfiles.status).toBe(200);
});
