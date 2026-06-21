import nodemailer from "nodemailer";
import type { MailboxConfig } from "./types";
import type { MailSendInput, MailSender, MailSendResult } from "./types";
import { sanitizeMailError } from "./sanitize";

export function createSmtpSender(config: MailboxConfig): MailSender {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.auth.user,
      pass: config.auth.pass,
    },
    requireTLS: !config.smtp.secure,
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
          to: input.to,
          subject: input.subject,
          text: input.text,
          ...(input.html ? { html: input.html } : {}),
        });

        return { messageId: info.messageId || "sent" };
      } catch (err) {
        throw new Error(sanitizeMailError(err));
      }
    },
  };
}
