import {
  DEFAULT_WHATSAPP_PROFILE_ID,
  getWhatsAppConfigPath,
  loadWhatsAppConfigFile,
  resolveWhatsAppConfigFromSources,
} from "@nakama/core/whatsapp-config";

export interface WhatsAppBridgeConfig {
  phoneNumber: string;
  profileId: string;
}

export async function loadConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<WhatsAppBridgeConfig> {
  const file = await loadWhatsAppConfigFile();
  const resolved = resolveWhatsAppConfigFromSources({ env, file });

  if (!resolved) {
    throw new Error(formatNotConfiguredMessage());
  }

  return {
    phoneNumber: resolved.phoneNumber,
    profileId: resolved.profileId || DEFAULT_WHATSAPP_PROFILE_ID,
  };
}

function formatNotConfiguredMessage(): string {
  return [
    "WhatsApp is not configured.",
    "",
    "From the web dashboard:",
    "  1. Run: bun run dev:server  (and bun run dev:web if needed)",
    "  2. Open Integrations \u2192 WhatsApp",
    "  3. Choose a reply profile and click Enable WhatsApp",
    "  4. Run: bun run dev:whatsapp",
    "  5. Scan the QR code, or generate a pairing code in WhatsApp",
    "",
    "Or set env var: WHATSAPP_PHONE_NUMBER",
    `Config file: ${getWhatsAppConfigPath()}`,
  ].join("\n");
}