import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import {
  getUserConfigDir,
  getUserConfigPath,
  loadUserConfig,
  saveUserConfig,
} from "@tinyclaw/core";

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY_DAYS = 7;

export interface AuthServiceConfig {
  jwtSecret: string;
}

export async function resolveJwtSecret(): Promise<string> {
  const envSecret = process.env.TINYCLAW_JWT_SECRET;
  if (envSecret) {
    return envSecret;
  }

  const config = await loadUserConfig();
  const persistedSecret = config?.jwtSecret;
  if (persistedSecret) {
    return persistedSecret;
  }

  const generated = crypto.randomUUID().replace(/-/g, "");
  const newConfig = config ?? {
    defaultProviderId: null,
    providers: [],
  };
  await saveUserConfig({ ...newConfig, jwtSecret: generated });

  return generated;
}

export class AuthService {
  private readonly jwtSecret: Uint8Array;

  constructor(config: AuthServiceConfig) {
    this.jwtSecret = new TextEncoder().encode(config.jwtSecret);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async createToken(email: string): Promise<string> {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_EXPIRY_DAYS}d`)
      .sign(this.jwtSecret);
  }

  async verifyToken(token: string): Promise<{ email: string }> {
    const { payload } = await jwtVerify(token, this.jwtSecret, {
      clockTolerance: 60,
    });
    if (typeof payload.email !== "string") {
      throw new Error("Invalid token payload");
    }
    return { email: payload.email };
  }
}
