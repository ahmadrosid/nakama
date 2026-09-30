import { expect, test } from "bun:test";
import { createSqliteMemoryAdapter } from "./adapters/sqlite";

test("creating a passkey challenge prunes an expired challenge with the same id", async () => {
  const db = createSqliteMemoryAdapter();
  const now = "2026-01-01T00:00:00.000Z";
  const expiresAt = "2026-01-01T00:05:00.000Z";

  await db.createUser({
    createdAt: now,
    email: "passkey@example.com",
    id: "user_passkey",
    passwordHash: "unused",
    updatedAt: now,
  });
  await db.createPasskeyChallenge({
    challenge: "reused-challenge",
    createdAt: "2025-12-31T23:55:00.000Z",
    expiresAt: "2025-12-31T23:59:00.000Z",
    type: "authentication",
    userId: "user_passkey",
  });

  await db.createPasskeyChallenge({
    challenge: "reused-challenge",
    createdAt: now,
    expiresAt,
    type: "authentication",
    userId: "user_passkey",
  });

  await expect(
    db.consumePasskeyChallenge(
      "reused-challenge",
      "user_passkey",
      "authentication",
      now
    )
  ).resolves.toBe(true);
});

test("counts only unused backup codes", async () => {
  const db = createSqliteMemoryAdapter();
  const now = "2026-01-01T00:00:00.000Z";

  await db.createUser({
    createdAt: now,
    email: "backup@example.com",
    id: "user_backup",
    passwordHash: "unused",
    updatedAt: now,
  });
  await db.createMfaBackupCode({
    codeHash: "hash-1",
    createdAt: now,
    id: "backup-1",
    usedAt: null,
    userId: "user_backup",
  });
  await db.createMfaBackupCode({
    codeHash: "hash-2",
    createdAt: now,
    id: "backup-2",
    usedAt: null,
    userId: "user_backup",
  });

  expect(await db.countUnusedMfaBackupCodes("user_backup")).toBe(2);
  await db.consumeMfaBackupCode("user_backup", "hash-1", now);
  expect(await db.countUnusedMfaBackupCodes("user_backup")).toBe(1);
});

test("generic passkey challenges can be consumed by the credential owner", async () => {
  const db = createSqliteMemoryAdapter();
  const now = "2026-01-01T00:00:00.000Z";

  await db.createUser({
    createdAt: now,
    email: "generic-passkey@example.com",
    id: "user_generic_passkey",
    passwordHash: "unused",
    updatedAt: now,
  });
  await db.createPasskey({
    counter: 0,
    createdAt: now,
    credentialId: "credential-generic",
    id: "passkey-generic",
    name: "Passkey",
    publicKey: "public-key",
    transports: [],
    userId: "user_generic_passkey",
  });
  await db.createPasskeyChallenge({
    challenge: "generic-challenge",
    createdAt: now,
    expiresAt: "2026-01-01T00:05:00.000Z",
    type: "authentication",
    userId: null,
  });

  const passkey = await db.getPasskeyByCredentialId("credential-generic");
  expect(passkey?.userId).toBe("user_generic_passkey");
  await expect(
    db.consumePasskeyChallenge(
      "generic-challenge",
      "user_generic_passkey",
      "authentication",
      now
    )
  ).resolves.toBe(true);
});
