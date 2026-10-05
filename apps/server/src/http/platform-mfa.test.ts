import { expect, test } from "bun:test";
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
import type { AppFetch } from "./test-session-helpers";
import {
  loginPlatformAdminSession,
  seedOrgAdmin,
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

  // Required policy covers the platform-admin flag itself, so enroll the
  // platform admin before it is used to administer the policy below.
  const platformUser = await databaseAdapter.getUserByEmail(
    "platform@example.com"
  );
  if (!platformUser) {
    throw new Error("Expected platform admin user");
  }
  await databaseAdapter.updateUserMfa(
    platformUser.id,
    {
      enabled: true,
      mfaTotpLastStep: null,
      pendingTotpSecretEnc: null,
      totpSecretEnc: encryptTotpSecret(generateTotpSecret()),
    },
    new Date().toISOString()
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
  if (!session.orgId) {
    throw new Error("Expected setup organization");
  }
  await seedOrgAdmin(databaseAdapter, {
    authService,
    email: "viewer@example.com",
    orgId: session.orgId,
    role: "viewer",
    userId: "user_mfa_viewer",
  });
  const viewerLogin = await app.fetch(
    new Request("http://localhost:4310/v1/auth/login", {
      body: JSON.stringify({
        email: "viewer@example.com",
        password: "password123",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(await viewerLogin.json()).toMatchObject({
    mfaRequired: false,
  });
  // The setup user is a platform admin, so the required policy covers it even
  // though its "admin" org role is not in enforcedRoles.
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
    mfaRequired: true,
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

test("blocks a platform admin without an organization until MFA is enrolled", async () => {
  const { app, authService, databaseAdapter } = createMinimalHonoApp();
  const setupSession = await setupFreshInstallSession(
    app as AppFetch,
    databaseAdapter
  );

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

  // No organization membership at all: the platform-admin flag is the only
  // authority this session carries.
  const platformSession = await loginPlatformAdminSession(
    app as AppFetch,
    authService,
    databaseAdapter
  );
  const platformUser = await databaseAdapter.getUserByEmail(
    "platform@example.com"
  );
  if (!platformUser) {
    throw new Error("Expected platform admin user");
  }
  expect(
    await databaseAdapter.listUserOrganizations(platformUser.id)
  ).toHaveLength(0);

  const blockedOrgs = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      headers: platformSession.headers(),
    })
  );
  expect(blockedOrgs.status).toBe(403);
  expect(await blockedOrgs.json()).toMatchObject({
    error: "Complete MFA enrollment before accessing this resource.",
  });

  const blockedOrgCreate = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      body: JSON.stringify({ name: "Should Not Exist", slug: "nope" }),
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(blockedOrgCreate.status).toBe(403);

  const startResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/start", {
      headers: platformSession.headers({
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(startResponse.status).toBe(200);
  const startBody = (await startResponse.json()) as { secret: string };
  const verifyResponse = await app.fetch(
    new Request("http://localhost:4310/v1/auth/mfa/totp/verify", {
      body: JSON.stringify({ code: createTotpCode(startBody.secret) }),
      headers: platformSession.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": platformSession.csrfToken,
      }),
      method: "POST",
    })
  );
  expect(verifyResponse.status).toBe(200);

  const allowedOrgs = await app.fetch(
    new Request("http://localhost:4310/v1/platform/orgs", {
      headers: platformSession.headers(),
    })
  );
  expect(allowedOrgs.status).toBe(200);
  expect(
    (await allowedOrgs.json()) as { organizations: unknown[] }
  ).toMatchObject({
    organizations: expect.any(Array),
  });
});
