import { createHash, randomBytes } from "node:crypto";

const SALT_ROUNDS = 10;
const SESSION_EXPIRY_DAYS = 7;

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: SALT_ROUNDS,
    });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return Bun.password.verify(password, hash);
  }

  createBrowserSessionTokens(): {
    sessionToken: string;
    csrfToken: string;
    expiresAt: string;
  } {
    return {
      csrfToken: generateOpaqueToken(),
      expiresAt: new Date(
        Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
      sessionToken: generateOpaqueToken(),
    };
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}
