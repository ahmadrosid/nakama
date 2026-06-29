import { loadWhatsAppConfigFile } from "../whatsapp-config";
import type { ChannelSendResult, WhatsAppOutboundAdapter } from "./types";

const DEFAULT_OUTBOUND_PORT = 4312;

export interface WhatsAppOutboundOptions {
  fetchImpl?: typeof fetch;
}

export function resolveWhatsAppOutboundPort(config: { outboundPort?: string | null } | null): number {
  const raw = config?.outboundPort?.trim();

  if (!raw) {
    return DEFAULT_OUTBOUND_PORT;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_OUTBOUND_PORT;
  }

  return parsed;
}

export function createWhatsAppOutboundAdapter(
  options: WhatsAppOutboundOptions = {},
): WhatsAppOutboundAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(input): Promise<ChannelSendResult> {
      try {
        const config = await loadWhatsAppConfigFile();

        if (!config?.pairedJid) {
          return { ok: false, error: "WhatsApp is not paired." };
        }

        const port = resolveWhatsAppOutboundPort(config);
        const response = await fetchImpl(`http://127.0.0.1:${port}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: input.text }),
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            ok: false,
            error: `WhatsApp worker error (${response.status}): ${body.slice(0, 200)}`,
          };
        }

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    },
  };
}
