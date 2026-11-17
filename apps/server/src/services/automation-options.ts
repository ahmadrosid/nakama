import type { ManagedSecrets } from "./managed-secrets";

export interface AutomationServiceOptions {
  canSendEmail?: (profileId: string, orgId: string) => Promise<boolean>;
  getUserTimezone: () => Promise<string>;
  onChange?: () => void | Promise<void>;
  secrets?: Pick<
    ManagedSecrets,
    "decryptWebhookSecret" | "encryptWebhookSecret"
  >;
}
