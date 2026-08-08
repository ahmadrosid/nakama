import nodemailer from "nodemailer";
import { sanitizeMailError } from "./sanitize";
import type {
  MailboxConfig,
  MailSender,
  MailSendInput,
  MailSendResult,
} from "./types";

export function createSmtpSender(config: MailboxConfig): MailSender {
  const transporter = nodemailer.createTransport({
    auth: {
      pass: config.auth.pass,
      user: config.auth.user,
    },
    host: config.smtp.host,
    port: config.smtp.port,
    requireTLS: !config.smtp.secure,
    secure: config.smtp.secure,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });

  return {
    async send(input: MailSendInput): Promise<MailSendResult> {
      try {
        const info = await transporter.sendMail({
          from: config.from,
          subject: input.subject,
          text: input.text,
          to: input.to,
          ...(input.html ? { html: input.html } : {}),
        });

        return { messageId: info.messageId || "sent" };
      } catch (err) {
        throw new Error(sanitizeMailError(err));
      }
    },
  };
}
