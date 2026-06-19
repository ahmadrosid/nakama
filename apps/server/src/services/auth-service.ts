import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";

const SALT_ROUNDS = 10;
const SESSION_EXPIRY_DAYS = 7;

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  createBrowserSessionTokens(): {
    sessionToken: string;
    csrfToken: string;
    expiresAt: string;
  } {
    return {
      sessionToken: generateOpaqueToken(),
      csrfToken: generateOpaqueToken(),
      expiresAt: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("base64url");
  }
}

function generateOpaqueToken(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}
