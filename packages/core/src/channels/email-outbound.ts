import { emailConfigToMailboxConfig, isEmailConfigComplete, loadEmailConfig } from "../email-config";
import { createSmtpSender } from "../mail/smtp-sender";
import type { ChannelSendResult, EmailOutboundAdapter } from "./types";

export function createEmailOutboundAdapter(): EmailOutboundAdapter {
  return {
    async send(input): Promise<ChannelSendResult> {
      try {
        const config = await loadEmailConfig();

        if (!isEmailConfigComplete(config)) {
          return { ok: false, error: "Email is not configured." };
        }

        const sender = createSmtpSender(emailConfigToMailboxConfig(config!));
        await sender.send({
          to: input.to,
          subject: input.subject,
          text: input.text,
        });

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
  };
}
