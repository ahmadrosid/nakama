import type {
  ListProfilesResponse,
  ListUserOrgsResponse,
  ProfileSummary,
  UserOrgSummary,
} from "./contract";

/** Client methods channel bridges (Telegram, WhatsApp, CLI) must use. */
export const BRIDGE_CLIENT_METHODS = [
  "listUserOrgs",
  "listProfiles",
  "setOrgId",
  "createSession",
  "createChatSession",
] as const;

export type BridgeClientMethod = (typeof BRIDGE_CLIENT_METHODS)[number];

export function assertBridgeClientMethods(client: object): void {
  for (const method of BRIDGE_CLIENT_METHODS) {
    if (typeof (client as Record<string, unknown>)[method] !== "function") {
      throw new Error(`Bridge client is missing required method: ${method}`);
    }
  }
}

function isUserOrgSummary(value: unknown): value is UserOrgSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const org = value as Record<string, unknown>;
  return (
    typeof org.id === "string" &&
    typeof org.name === "string" &&
    typeof org.slug === "string" &&
    typeof org.role === "string"
  );
}

export function parseListUserOrgsResponse(body: unknown): ListUserOrgsResponse {
  if (typeof body !== "object" || body === null || !("orgs" in body)) {
    throw new Error("Invalid /v1/auth/orgs response: expected { orgs: [...] }");
  }

  const orgs = (body as { orgs: unknown }).orgs;
  if (!(Array.isArray(orgs) && orgs.every(isUserOrgSummary))) {
    throw new Error(
      "Invalid /v1/auth/orgs response: each org needs id, name, slug, and role"
    );
  }

  return { orgs };
}

function isProfileSummary(value: unknown): value is ProfileSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const profile = value as Record<string, unknown>;
  return typeof profile.id === "string" && typeof profile.name === "string";
}

export function parseListProfilesResponse(body: unknown): ListProfilesResponse {
  if (typeof body !== "object" || body === null || !("profiles" in body)) {
    throw new Error(
      "Invalid /v1/profiles response: expected { profiles: [...] }"
    );
  }

  const profiles = (body as { profiles: unknown }).profiles;
  if (!(Array.isArray(profiles) && profiles.every(isProfileSummary))) {
    throw new Error(
      "Invalid /v1/profiles response: each profile needs at least id and name"
    );
  }

  return { profiles };
}
