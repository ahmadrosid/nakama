import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getMfaEncryptionKey } from "./mfa-config";

const DIGITS = 6;
const STEP_SECONDS = 30;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(value: string): Buffer {
  let bits = "";
  for (const character of value.replace(/[=\s]/gu, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error("Invalid TOTP secret.");
    }
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(value: Buffer): string {
  let bits = "";
  for (const byte of value) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let result = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    result +=
      BASE32_ALPHABET[
        Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)
      ];
  }
  return result;
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(getMfaEncryptionKey(), "base64url"),
    iv
  );
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url"
  );
}

export function decryptTotpSecret(value: string): string {
  const encoded = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(getMfaEncryptionKey(), "base64url"),
    encoded.subarray(0, 12)
  );
  decipher.setAuthTag(encoded.subarray(12, 28));
  return Buffer.concat([
    decipher.update(encoded.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export function hashBackupCode(code: string, mfaEncryptionKey: string): string {
  return createHmac("sha256", Buffer.from(mfaEncryptionKey, "base64url"))
    .update(code.trim().toUpperCase())
    .digest("base64url");
}

export function createTotpCode(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(message)
    .digest();
  const offset = digest[digest.length - 1]! % 16;
  const code = (digest.readUInt32BE(offset) % 2_147_483_648) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

export function findTotpStep(
  secret: string,
  code: string,
  timestamp = Date.now()
): number | null {
  const normalized = Buffer.from(code.trim(), "utf8");
  const currentStep = Math.floor(timestamp / 1000 / STEP_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const step = currentStep + offset;
    const expected = Buffer.from(
      createTotpCode(secret, step * STEP_SECONDS * 1000),
      "utf8"
    );
    if (
      expected.length === normalized.length &&
      timingSafeEqual(expected, normalized)
    ) {
      return step;
    }
  }
  return null;
}
