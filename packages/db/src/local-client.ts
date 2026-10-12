import {
  LOCAL_CLIENT_EMAIL,
  LOCAL_CLIENT_USER_ID,
} from "@nakama/core/local-auth";
import type { DatabaseAdapter } from "./types";

const SALT_ROUNDS = 10;

const PLACEHOLDER_HASH = "unused";

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "bcrypt",
    cost: SALT_ROUNDS,
  });
}

export async function ensureLocalClientAccess(
  db: DatabaseAdapter
): Promise<void> {
  const now = new Date().toISOString();
  let user = await db.getUserByEmail(LOCAL_CLIENT_EMAIL);

  if (!user) {
    user = await db.getUserById(LOCAL_CLIENT_USER_ID);
  }

  if (!user) {
    await db.createUser({
      createdAt: now,
      email: LOCAL_CLIENT_EMAIL,
      id: LOCAL_CLIENT_USER_ID,
      passwordHash: await hashPassword(generateRandomPassword()),
      updatedAt: now,
    });
    user = await db.getUserByEmail(LOCAL_CLIENT_EMAIL);
  } else if (user.passwordHash === PLACEHOLDER_HASH) {
    await db.updateUserPassword(
      user.id,
      await hashPassword(generateRandomPassword()),
      now
    );
  }

  if (!user) {
    return;
  }

  for (const org of await db.listOrganizations()) {
    const member = await db.getOrgMember(org.id, user.id);

    if (member) {
      continue;
    }

    await db.upsertOrgMember({
      createdAt: now,
      orgId: org.id,
      role: "admin",
      userId: user.id,
    });
  }
}

function generateRandomPassword(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}
