import type { NakamaClient } from "@nakama/client";
import { loadSavedCliOrgId, saveCliOrgId } from "./cli-config";

export interface CliOrgOptions {
  orgId?: string;
}

export class InvalidOrgArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOrgArgError";
  }
}

/** Org ids (`org_…`) plus slugs resolved by `assertOrgMembership`. */
const ORG_ID_PATTERN = /^org_[A-Za-z0-9]+$/;
const ORG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const MAX_ORG_REF_LENGTH = 128;

function assertOrgRef(value: string): string {
  if (value.length > MAX_ORG_REF_LENGTH) {
    throw new InvalidOrgArgError(
      `Invalid --org value: exceeds ${MAX_ORG_REF_LENGTH} characters.`
    );
  }

  if (ORG_ID_PATTERN.test(value) || ORG_SLUG_PATTERN.test(value)) {
    return value;
  }

  throw new InvalidOrgArgError(
    `Invalid --org value "${value}". Expected org_<id> or a slug.`
  );
}

export function parseCliOrgArgs(argv = process.argv.slice(2)): CliOrgOptions {
  let orgId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--org" || arg === "-o") {
      const raw = argv[index + 1]?.trim();
      if (!raw || raw.startsWith("-")) {
        throw new InvalidOrgArgError(
          "Missing value for --org. Use --org org_<id> or a slug."
        );
      }
      orgId = assertOrgRef(raw);
      index += 1;
      continue;
    }

    if (arg.startsWith("--org=")) {
      const raw = arg.slice("--org=".length).trim();
      if (!raw) {
        throw new InvalidOrgArgError(
          "Missing value for --org. Use --org=org_<id> or a slug."
        );
      }
      orgId = assertOrgRef(raw);
    }
  }

  return { orgId: orgId || undefined };
}

export async function resolveCliOrgId(
  client: NakamaClient,
  options: CliOrgOptions = {}
): Promise<string> {
  const explicitOrgId =
    options.orgId?.trim() ||
    process.env.NAKAMA_ORG_ID?.trim() ||
    (await loadSavedCliOrgId());

  if (explicitOrgId) {
    const orgId = await assertOrgMembership(client, explicitOrgId);
    client.setOrgId(orgId);
    await saveCliOrgId(orgId);
    return orgId;
  }

  const me = await client.getMe();

  if (me.activeOrgId?.trim()) {
    client.setOrgId(me.activeOrgId);
    await saveCliOrgId(me.activeOrgId);
    return me.activeOrgId;
  }

  const { orgs } = await client.listUserOrgs();
  const [onlyOrg] = orgs;

  if (!onlyOrg) {
    throw new Error("No organizations found.");
  }

  if (orgs.length === 1) {
    client.setOrgId(onlyOrg.id);
    await saveCliOrgId(onlyOrg.id);
    return onlyOrg.id;
  }

  throw new Error(
    [
      "Multiple organizations are available.",
      "Pass --org <id> (or set NAKAMA_ORG_ID).",
      "",
      ...orgs.map((org) => `  ${org.id}  ${org.name}`),
    ].join("\n")
  );
}

async function assertOrgMembership(
  client: NakamaClient,
  orgRef: string
): Promise<string> {
  const { orgs } = await client.listUserOrgs();
  const normalized = orgRef.trim().toLowerCase();
  const match = orgs.find(
    (org) => org.id === orgRef || org.slug.toLowerCase() === normalized
  );

  if (!match) {
    throw new Error(`Unknown organization: ${orgRef}`);
  }

  return match.id;
}
