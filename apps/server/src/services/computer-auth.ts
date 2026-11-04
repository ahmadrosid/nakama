import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import type { DatabaseAdapter, StoredComputerRecord } from "@nakama/db";
import { z } from "zod";
import type { ManagedSecrets } from "./managed-secrets";

/**
 * Nakama Desktop computers. A computer holds an Ed25519 key that never leaves
 * it. It signs a fresh request to get a short-lived pass, and sends the pass
 * with each model call. The cloud keeps only the public key.
 */
export const COMPUTER_PASS_TTL_MS = 15 * 60 * 1000;

export const LLM_TOKEN_PATH = "/v1/llm/token";

const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * How long a Connect result can still be confirmed: the desktop's sign-in
 * window. A code left in browser history stops working after it.
 */
const CONFIRM_WINDOW_MS = 10 * 60 * 1000;

const PASS_KEY_SCOPE = "global";

const PASS_KEY_SECRET = "computer-pass-key";

/** The raw 32-byte Ed25519 public key in a DER (SPKI) wrapper. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const computerTokenRequestSchema = z
  .object({
    computerId: z.string().min(1).max(200),
    /** Only on the first request after Connect: proves the result came here. */
    confirmCode: z.string().min(16).max(200).optional(),
    nonce: z.string().min(16).max(200),
    signature: z.string().min(1).max(200),
    timestamp: z.number().int(),
  })
  .strict();

export type ComputerTokenRequest = z.infer<typeof computerTokenRequestSchema>;

const passSchema = z.object({
  c: z.string(),
  e: z.number(),
  o: z.string(),
  u: z.string(),
});

/** The bytes a computer signs. Method and path bind it to one route. */
export function computerTokenPayload(
  request: Omit<ComputerTokenRequest, "signature">,
  route: { method: string; path: string }
): Buffer {
  return Buffer.from(
    [
      route.method.toUpperCase(),
      route.path,
      request.computerId,
      String(request.timestamp),
      request.nonce,
    ].join("\n")
  );
}

/** True for a base64 string that holds exactly one raw Ed25519 public key. */
export function isEd25519PublicKey(value: string): boolean {
  const raw = Buffer.from(value, "base64");

  if (raw.length !== 32 || raw.toString("base64") !== value) {
    return false;
  }

  try {
    toPublicKey(value);

    return true;
  } catch {
    return false;
  }
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function toPublicKey(value: string) {
  return createPublicKey({
    format: "der",
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(value, "base64")]),
    type: "spki",
  });
}

export interface ComputerAccess {
  computer: StoredComputerRecord;
  orgId: string;
  userId: string;
}

export class ComputerAuthService {
  private passKey: Promise<Buffer> | null = null;

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly now: () => number = Date.now,
    private readonly secrets?: ManagedSecrets
  ) {}

  /**
   * The key that signs passes. It is kept in the secrets store, so a pass
   * stays valid after a restart and on each process that shares the database.
   * Without a secrets key it lives only in this process.
   */
  private signingKey(): Promise<Buffer> {
    this.passKey ??= this.loadOrCreatePassKey().catch((error: Error) => {
      this.passKey = null;
      throw error;
    });

    return this.passKey;
  }

  private async loadOrCreatePassKey(): Promise<Buffer> {
    const stored = this.secrets
      ? await this.secrets.resolve(PASS_KEY_SCOPE, PASS_KEY_SECRET)
      : null;

    if (stored?.value) {
      return Buffer.from(stored.value, "base64");
    }

    const key = randomBytes(32);

    if (!this.secrets) {
      return key;
    }

    // Saves only when no key is stored yet. It throws without
    // NAKAMA_SECRETS_KEY, or when another process saved first.
    await this.secrets
      .migrate(PASS_KEY_SCOPE, PASS_KEY_SECRET, key.toString("base64"))
      .catch(() => undefined);

    const saved = await this.secrets.resolve(PASS_KEY_SCOPE, PASS_KEY_SECRET);

    // Nothing stored (no secrets key): a pass is valid only in this process.
    return saved.value ? Buffer.from(saved.value, "base64") : key;
  }

  /**
   * Saves the key from the Connect page for the signed-in user and org. Null
   * when this install is already connected with another key.
   */
  async enroll(input: {
    installId: string;
    name: string;
    orgId: string;
    publicKey: string;
    userId: string;
  }): Promise<{ computer: StoredComputerRecord; confirmCode: string } | null> {
    const at = new Date(this.now()).toISOString();

    // Only the Connect result on 127.0.0.1 carries this code, so a key sent
    // in someone else's link is never activated.
    const confirmCode = randomBytes(24).toString("base64url");

    const computer = await this.db.enrollComputer({
      createdAt: at,
      id: `computer_${randomUUID()}`,
      installId: input.installId,
      lastSeenAt: null,
      name: input.name,
      orgId: input.orgId,
      pendingCodeHash: hashCode(confirmCode),
      publicKey: input.publicKey,
      revokedAt: null,
      userId: input.userId,
    });

    if (!computer) {
      return null;
    }

    await this.audit("computer.enroll", computer, at);

    return { computer, confirmCode };
  }

  list(input: { orgId: string; userId: string }) {
    return this.db.listComputersForUser(input.orgId, input.userId);
  }

  async revoke(input: {
    id: string;
    orgId: string;
    userId: string;
  }): Promise<boolean> {
    const at = new Date(this.now()).toISOString();
    const revoked = await this.db.revokeComputer({ ...input, revokedAt: at });

    if (revoked) {
      const computer = await this.db.getComputer(input.id);

      if (computer) {
        await this.audit("computer.revoke", computer, at);
      }
    }

    return revoked;
  }

  /**
   * Checks a signed token request and returns a pass. With the server time
   * when the computer's clock is off, so it can correct it and sign again.
   * Null when the signature or nonce is wrong, or the computer has lost
   * access.
   */
  async issuePass(
    request: ComputerTokenRequest,
    route: { method: string; path: string }
  ): Promise<
    { expiresAt: number; pass: string } | { serverTime: number } | null
  > {
    const now = this.now();

    if (Math.abs(now - request.timestamp) > CLOCK_SKEW_MS) {
      return { serverTime: now };
    }

    const access = await this.activeAccess(request.computerId);

    if (!access) {
      return null;
    }

    const signed = verify(
      null,
      computerTokenPayload(request, route),
      toPublicKey(access.computer.publicKey),
      Buffer.from(request.signature, "base64")
    );

    if (!signed) {
      return null;
    }

    const pending = access.computer.pendingCodeHash;

    if (
      pending &&
      now - Date.parse(access.computer.createdAt) > CONFIRM_WINDOW_MS
    ) {
      return null;
    }

    if (
      pending &&
      !(
        request.confirmCode &&
        timingSafeEqual(
          Buffer.from(hashCode(request.confirmCode)),
          Buffer.from(pending)
        )
      )
    ) {
      return null;
    }

    const fresh = await this.db.consumeComputerNonce(
      `${request.computerId}:${request.nonce}`,
      new Date(request.timestamp + CLOCK_SKEW_MS).toISOString(),
      new Date(now).toISOString()
    );

    if (!fresh) {
      return null;
    }

    if (pending) {
      await this.db.activateComputer(access.computer.id);
    }

    await this.db.setComputerLastSeen(
      access.computer.id,
      new Date(now).toISOString()
    );

    const expiresAt = now + COMPUTER_PASS_TTL_MS;

    const body = Buffer.from(
      JSON.stringify({
        c: access.computer.id,
        e: expiresAt,
        o: access.orgId,
        u: access.userId,
      })
    ).toString("base64url");

    return { expiresAt, pass: `${body}.${await this.sign(body)}` };
  }

  /**
   * Checks a pass and checks again that the computer is not revoked and the
   * user is still an enabled member, so a removal acts on the next call.
   */
  async verifyPass(pass: string): Promise<ComputerAccess | null> {
    const [body, signature, extra] = pass.split(".");

    if (!(body && signature) || extra !== undefined) {
      return null;
    }

    const expected = Buffer.from(await this.sign(body));
    const actual = Buffer.from(signature);

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return null;
    }

    let parsed: z.infer<typeof passSchema>;

    try {
      parsed = passSchema.parse(
        JSON.parse(Buffer.from(body, "base64url").toString())
      );
    } catch {
      return null;
    }

    if (parsed.e <= this.now()) {
      return null;
    }

    const access = await this.activeAccess(parsed.c);

    return access?.orgId === parsed.o && access.userId === parsed.u
      ? access
      : null;
  }

  private async activeAccess(
    computerId: string
  ): Promise<ComputerAccess | null> {
    const computer = await this.db.getComputer(computerId);

    if (!computer || computer.revokedAt) {
      return null;
    }

    const [member, user] = await Promise.all([
      this.db.getOrgMember(computer.orgId, computer.userId),
      this.db.getUserById(computer.userId),
    ]);

    // Disabling keeps the membership row, so check the user too.
    return member && user && !user.disabledAt
      ? { computer, orgId: computer.orgId, userId: computer.userId }
      : null;
  }

  private async sign(body: string): Promise<string> {
    return createHmac("sha256", await this.signingKey())
      .update(body)
      .digest("base64url");
  }

  private async audit(
    action: "computer.enroll" | "computer.revoke",
    computer: StoredComputerRecord,
    at: string
  ): Promise<void> {
    await this.db
      .createAuditEvent({
        action,
        actorUserId: computer.userId,
        createdAt: at,
        id: `audit_${randomUUID()}`,
        metadata: { installId: computer.installId, name: computer.name },
        orgId: computer.orgId,
        requestId: null,
        resourceId: computer.id,
        resourceType: "computer",
      })
      .catch(() => undefined);
  }
}
