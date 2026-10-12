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
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  options: Record<string, unknown>
): Promise<PasskeyCredentialResponse> {
  if (!browserSupportsWebAuthn()) {
    throw new Error("Passkeys are not supported by this browser.");
  }

  // SAFETY: The server returns creation options in SimpleWebAuthn's JSON format.
  return (await startRegistration({
    // SAFETY: The passkey endpoint returns the fields SimpleWebAuthn requires.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The API contract types passkey JSON as a generic record.
    optionsJSON: options as unknown as BrowserOptions,
  })) as PasskeyCredentialResponse;
}

export async function getPasskey(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This dictionary holds external JSON keys until the boundary parser validates each value.
  options: Record<string, unknown>
): Promise<PasskeyCredentialResponse> {
  if (!browserSupportsWebAuthn()) {
    throw new Error("Passkeys are not supported by this browser.");
  }

  // SAFETY: The server returns request options in SimpleWebAuthn's JSON format.
  return (await startAuthentication({
    // SAFETY: The passkey endpoint returns the fields SimpleWebAuthn requires.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The API contract types passkey JSON as a generic record.
    optionsJSON: options as unknown as AuthenticationOptions,
  })) as PasskeyCredentialResponse;
}
