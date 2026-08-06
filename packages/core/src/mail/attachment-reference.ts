import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ToolContext } from "../contract";
import type { MailboxConfig } from "./types";

const REFERENCE_TTL_MS = 10 * 60 * 1000;

interface AttachmentReferenceClaims {
  orgId: string;
  profileId: string;
  sessionId: string;
  mailboxId: string;
  folder: string;
  uid: number;
  attachmentId: string;
  expiresAt: number;
}

function contextScope(context: ToolContext): Pick<
  AttachmentReferenceClaims,
  "orgId" | "profileId" | "sessionId"
> {
  const sessionId = context.sessionId ?? context.automationRunId;
  if (!context.orgId || !context.profileId || !sessionId) {
    throw new Error("Email attachment references require an organization, profile, and session.");
  }

  return {
    orgId: context.orgId,
    profileId: context.profileId,
    sessionId,
  };
}

function sign(payload: string): string {
  const secret = process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "NAKAMA_EMAIL_ATTACHMENT_SECRET must be configured with at least 32 characters.",
    );
  }

  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function getMailboxIdentity(config: MailboxConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        host: config.imap.host,
        port: config.imap.port,
        user: config.auth.user,
      }),
    )
    .digest("base64url");
}

export function createAttachmentReference(
  context: ToolContext,
  input: { folder: string; uid: number; attachmentId: string; mailboxId: string },
): string {
  const claims: AttachmentReferenceClaims = {
    ...contextScope(context),
    ...input,
    expiresAt: Date.now() + REFERENCE_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyAttachmentReference(
  context: ToolContext,
  reference: string,
  mailboxId: string,
): Omit<AttachmentReferenceClaims, "orgId" | "profileId" | "sessionId"> {
  const parts = reference.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid email attachment reference.");
  }
  const [payload, signature] = parts;

  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid email attachment reference.");
  }

  let claims: AttachmentReferenceClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AttachmentReferenceClaims;
  } catch {
    throw new Error("Invalid email attachment reference.");
  }

  const scope = contextScope(context);
  if (
    claims.orgId !== scope.orgId ||
    claims.profileId !== scope.profileId ||
    claims.sessionId !== scope.sessionId ||
    claims.mailboxId !== mailboxId ||
    !Number.isInteger(claims.uid) ||
    claims.expiresAt <= Date.now()
  ) {
    throw new Error("Email attachment reference expired or out of scope.");
  }

  return {
    folder: claims.folder,
    uid: claims.uid,
    attachmentId: claims.attachmentId,
    mailboxId: claims.mailboxId,
    expiresAt: claims.expiresAt,
  };
}
