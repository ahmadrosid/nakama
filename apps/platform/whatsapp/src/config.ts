import {
  DEFAULT_WHATSAPP_PROFILE_ID,
  getWhatsAppConfigPath,
  loadWhatsAppConfigFile,
  resolveWhatsAppConfigFromSources,
} from "@tinyclaw/core/whatsapp-config";

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
    const hasEnvPhone = Boolean(env.WHATSAPP_PHONE_NUMBER?.trim());

    if (!hasEnvPhone && !file) {
      throw new Error(formatNotConfiguredMessage());
    }

    throw new Error(`${formatNotConfiguredMessage()}\n\nMissing: phone number.`);
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
    "  2. Open Settings \u2192 WhatsApp",
    "  3. Enter your phone number and profile, then Save",
    "  4. Copy the pairing code, run: bun run dev:whatsapp",
    "  5. Enter the pairing code in WhatsApp \u2192 Settings \u2192 Linked Devices",
    "",
    "Or set env var: WHATSAPP_PHONE_NUMBER",
    `Config file: ${getWhatsAppConfigPath()}`,
  ].join("\n");
}