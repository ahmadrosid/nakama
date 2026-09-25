import type { PasskeyCredentialResponse } from "@nakama/core/contract";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

type AuthenticationOptions = Parameters<
  typeof startAuthentication
>[0]["optionsJSON"];

type BrowserOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

export async function createPasskey(
  options: Record<string, unknown>
): Promise<PasskeyCredentialResponse> {
  if (!browserSupportsWebAuthn()) {
    throw new Error("Passkeys are not supported by this browser.");
  }
  return (await startRegistration({
    optionsJSON: options as unknown as BrowserOptions,
  })) as PasskeyCredentialResponse;
}

export async function getPasskey(
  options: Record<string, unknown>
): Promise<PasskeyCredentialResponse> {
  if (!browserSupportsWebAuthn()) {
    throw new Error("Passkeys are not supported by this browser.");
  }
  return (await startAuthentication({
    optionsJSON: options as unknown as AuthenticationOptions,
  })) as PasskeyCredentialResponse;
}
