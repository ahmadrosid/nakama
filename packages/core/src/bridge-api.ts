import { z } from "zod";
import type { ProfileSummary, UserOrgSummary } from "./contract";

const BridgeClientSchema = z
  .object({
    createChatSession: z.function().optional(),
    createSession: z.function().optional(),
    listProfiles: z.function().optional(),
    listUserOrgs: z.function().optional(),
    setOrgId: z.function().optional(),
  })
  .passthrough();

const BridgeOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["admin", "member", "viewer"]),
  slug: z.string(),
});

const BridgeProfileSchema = z.object({
  id: z.string(),
  isDefault: z.boolean().optional(),
  isSuper: z.boolean().optional(),
  model: z.string().nullable().optional(),
  name: z.string(),
});

const UserOrgsResponseSchema = z.object({
  orgs: z.array(BridgeOrganizationSchema),
});

const ProfilesResponseSchema = z.object({
  profiles: z.array(BridgeProfileSchema),
});

export interface BridgeUserOrgSummary
  extends Pick<UserOrgSummary, "id" | "name" | "role" | "slug"> {}

export interface BridgeProfileSummary
  extends Pick<ProfileSummary, "id" | "name"> {
  isDefault?: boolean;
  isSuper?: boolean;
  model?: string | null;
}

export interface BridgeUserOrgsResponse {
  orgs: BridgeUserOrgSummary[];
}

export interface BridgeProfilesResponse {
  profiles: BridgeProfileSummary[];
}

/** Client methods channel bridges (Telegram, WhatsApp, CLI) must use. */
export const BRIDGE_CLIENT_METHODS = [
  "listUserOrgs",
  "listProfiles",
  "setOrgId",
  "createSession",
  "createChatSession",
] as const;

export function assertBridgeClientMethods<Client>(client: Client): void {
  const parsed = BridgeClientSchema.safeParse(client);

  if (!parsed.success) {
    throw new Error("Bridge client must be an object.");
  }

  for (const method of BRIDGE_CLIENT_METHODS) {
    const candidate = BridgeClientSchema.shape[method].safeParse(
      parsed.data[method]
    );

    if (parsed.data[method] === undefined || !candidate.success) {
      throw new Error(`Bridge client is missing required method: ${method}`);
    }
  }
}

export function parseListUserOrgsResponse<Body>(
  body: Body
): BridgeUserOrgsResponse {
  const response = UserOrgsResponseSchema.safeParse(body);

  if (!response.success) {
    throw new Error("Invalid /v1/auth/orgs response: expected { orgs: [...] }");
  }

  return response.data;
}

export function parseListProfilesResponse<Body>(
  body: Body
): BridgeProfilesResponse {
  const response = ProfilesResponseSchema.safeParse(body);

  if (!response.success) {
    throw new Error(
      "Invalid /v1/profiles response: expected { profiles: [...] }"
    );
  }

  return response.data;
}
