import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NakamaApiError, type StoredAutomation } from "@nakama/core";
import {
  automationWebhookSecretName,
  type ManagedSecrets,
} from "./managed-secrets";

export type WebhookSecretStore = Pick<
  ManagedSecrets,
  "delete" | "resolve" | "save"
>;

const WEBHOOK_SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

/** Saves a new random secret over the old one and returns it. */
export async function saveNewWebhookSecret(
  secrets: WebhookSecretStore,
  orgId: string,
  automationId: string
): Promise<string> {
  const secret = randomBytes(32).toString("base64url");

  try {
    await secrets.save(
      orgId,
      automationWebhookSecretName(automationId),
      secret
    );
  } catch (error) {
    // ManagedSecrets throws this exact copy when the key is unset.
    if (
      error instanceof Error &&
      error.message.includes("NAKAMA_SECRETS_KEY")
    ) {
      throw new NakamaApiError(
        `${error.message} Create a key with \`openssl rand -base64 32\`.`,
        400
      );
    }

    throw error;
  }

  return secret;
}

/** Checks a GitHub-style `X-Hub-Signature-256` header against the raw body. */
export async function webhookSignatureMatches(
  secrets: WebhookSecretStore,
  automation: StoredAutomation,
  body: Uint8Array,
  header: string | undefined
): Promise<boolean> {
  const match = WEBHOOK_SIGNATURE_PATTERN.exec(header ?? "");
  const orgId = automation.orgId;

  if (!(match?.[1] && orgId)) {
    return false;
  }

  const { value: secret } = await secrets.resolve(
    orgId,
    automationWebhookSecretName(automation.id)
  );

  if (!secret) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(match[1], "hex");

  // The pattern fixes the length, so timingSafeEqual cannot throw here.
  return timingSafeEqual(expected, received);
}

/** Runs after the row change, so it only logs. The next switch to webhook deletes a leftover. */
export async function deleteWebhookSecretOrLog(
  secrets: WebhookSecretStore | undefined,
  automation: StoredAutomation
): Promise<void> {
  if (!(secrets && automation.orgId)) {
    return;
  }

  try {
    await secrets.delete(
      automation.orgId,
      automationWebhookSecretName(automation.id)
    );
  } catch (error) {
    console.error("Automation webhook secret could not be deleted:", error);
  }
}
