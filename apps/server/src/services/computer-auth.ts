import {
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import type { DatabaseAdapter, StoredComputerRecord } from "@nakama/db";
import { z } from "zod";

/**
 * Nakama Desktop computers. A computer holds an Ed25519 key that never leaves
 * it. It signs a fresh request to get a short-lived pass, and sends the pass
 * with each model call. The cloud keeps only the public key.
 */
export const COMPUTER_PASS_TTL_MS = 15 * 60 * 1000;

export const LLM_TOKEN_PATH = "/v1/llm/token";

const CLOCK_SKEW_MS = 2 * 60 * 1000;

/** The raw 32-byte Ed25519 public key in a DER (SPKI) wrapper. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const computerTokenRequestSchema = z
  .object({
    computerId: z.string().min(1).max(200),
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
  /** Passes are signed with a key that lives only in this process. */
  private readonly passKey = randomBytes(32);

  constructor(
    private readonly db: DatabaseAdapter,
    private readonly now: () => number = Date.now
  ) {}

  /** Saves the key from the Connect page for the signed-in user and org. */
  async enroll(input: {
    installId: string;
    name: string;
    orgId: string;
    publicKey: string;
    userId: string;
  }): Promise<StoredComputerRecord> {
    const at = new Date(this.now()).toISOString();

    const computer = await this.db.enrollComputer({
      createdAt: at,
      id: `computer_${randomUUID()}`,
      installId: input.installId,
      lastSeenAt: null,
      name: input.name,
      orgId: input.orgId,
      publicKey: input.publicKey,
      revokedAt: null,
      userId: input.userId,
    });

    await this.audit("computer.enroll", computer, at);

    return computer;
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
   * Checks a signed token request and returns a pass. Null when the
   * signature, time or nonce is wrong, or the computer has lost access.
   */
  async issuePass(
    request: ComputerTokenRequest,
    route: { method: string; path: string }
  ): Promise<{ expiresAt: number; pass: string } | null> {
    const now = this.now();

    if (Math.abs(now - request.timestamp) > CLOCK_SKEW_MS) {
      return null;
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

    const fresh = await this.db.consumeComputerNonce(
      `${request.computerId}:${request.nonce}`,
      new Date(request.timestamp + CLOCK_SKEW_MS).toISOString(),
      new Date(now).toISOString()
    );

    if (!fresh) {
      return null;
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

    return { expiresAt, pass: `${body}.${this.sign(body)}` };
  }

  /**
   * Checks a pass and checks again that the computer is not revoked and the
   * user is still a member, so a removal acts on the next call.
   */
  async verifyPass(pass: string): Promise<ComputerAccess | null> {
    const [body, signature, extra] = pass.split(".");

    if (!(body && signature) || extra !== undefined) {
      return null;
    }

    const expected = Buffer.from(this.sign(body));
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

    const member = await this.db.getOrgMember(computer.orgId, computer.userId);

    return member
      ? { computer, orgId: computer.orgId, userId: computer.userId }
      : null;
  }

  private sign(body: string): string {
    return createHmac("sha256", this.passKey).update(body).digest("base64url");
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
