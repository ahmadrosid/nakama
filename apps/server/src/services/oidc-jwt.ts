import {
  createHash,
  type createPublicKey,
  createVerify,
  verify as cryptoVerify,
} from "node:crypto";
import { z } from "zod";

export const OidcDiscoverySchema = z.object({
  authorization_endpoint: z.string().min(1),
  issuer: z.string().min(1),
  jwks_uri: z.string().min(1),
  token_endpoint: z.string().min(1),
});

export type OidcDiscovery = z.infer<typeof OidcDiscoverySchema>;

const JsonWebKeySchema = z.object({
  alg: z.string().optional(),
  crv: z.string().optional(),
  e: z.string().optional(),
  kid: z.string().optional(),
  kty: z.string(),
  n: z.string().optional(),
  use: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
});

export type JsonWebKey = z.infer<typeof JsonWebKeySchema>;

export const JwksResponseSchema = z.object({
  keys: z.array(JsonWebKeySchema),
});

export const TokenResponseSchema = z.object({
  id_token: z.string().optional(),
});

export const JwtHeaderSchema = z.object({
  alg: z.string().optional(),
  kid: z.string().optional(),
});

export const IdTokenClaimsSchema = z
  .object({
    aud: z.union([z.string(), z.array(z.string())]).optional(),
    email: z.string().optional(),
    email_verified: z.union([z.boolean(), z.string()]).optional(),
    exp: z.number().optional(),
    iss: z.string().optional(),
    name: z.string().optional(),
    nonce: z.string().optional(),
    sub: z.string().optional(),
  })
  .passthrough();

/** Providers that emit a single string use a comma list. Anything else means no groups. */
export const GroupsClaimSchema = z
  .union([z.array(z.string()), z.string()])
  .transform((value): string[] =>
    Array.isArray(value)
      ? value
      : value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
  )
  .catch([]);

export interface OidcIdentityClaims {
  email: string | null;
  emailVerified: boolean;
  groups: string[];
  name: string | null;
  subject: string;
}

export function base64url(buffer: Buffer | Uint8Array): string {
  return Buffer.from(buffer).toString("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyForAlg(
  alg: string,
  key: ReturnType<typeof createPublicKey>,
  signed: string,
  signature: Buffer
): boolean {
  switch (alg) {
    case "RS256":
      return createVerify("RSA-SHA256").update(signed).verify(key, signature);
    case "RS384":
      return createVerify("RSA-SHA384").update(signed).verify(key, signature);
    case "RS512":
      return createVerify("RSA-SHA512").update(signed).verify(key, signature);
    case "ES256":
      return cryptoVerify(
        "sha256",
        Buffer.from(signed),
        { dsaEncoding: "ieee-p1363", key },
        signature
      );
    case "ES384":
      return cryptoVerify(
        "sha384",
        Buffer.from(signed),
        { dsaEncoding: "ieee-p1363", key },
        signature
      );
    case "EdDSA":
      return cryptoVerify(null, Buffer.from(signed), key, signature);
    default:
      return false;
  }
}
