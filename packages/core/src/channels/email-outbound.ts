import {
  emailConfigToMailboxConfig,
  isEmailConfigComplete,
  loadEmailConfig,
} from "../email-config";
import { createSmtpSender } from "../mail/smtp-sender";
import type { ChannelSendResult, EmailOutboundAdapter } from "./types";

export function createEmailOutboundAdapter(): EmailOutboundAdapter {
  return {
    async send(input): Promise<ChannelSendResult> {
      try {
        const config = await loadEmailConfig();

        if (!isEmailConfigComplete(config)) {
          return { error: "Email is not configured.", ok: false };
        }

        const sender = createSmtpSender(emailConfigToMailboxConfig(config));
        await sender.send({
          subject: input.subject,
          text: input.text,
          to: input.to,
        });

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, ok: false };
      }
    },
  };
}
