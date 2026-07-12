import type { NakamaClient } from "@nakama/client";
import { loadSavedCliOrgId, saveCliOrgId } from "./cli-config";

export interface CliOrgOptions {
  orgId?: string;
}

export function parseCliOrgArgs(argv = process.argv.slice(2)): CliOrgOptions {
  let orgId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--org" || arg === "-o") {
      orgId = argv[index + 1]?.trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--org=")) {
      orgId = arg.slice("--org=".length).trim();
    }
  }

  return { orgId: orgId || undefined };
}

export async function resolveCliOrgId(
  client: NakamaClient,
  options: CliOrgOptions = {},
): Promise<string> {
  const explicitOrgId =
    options.orgId?.trim() || process.env.NAKAMA_ORG_ID?.trim() || (await loadSavedCliOrgId());

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

  if (orgs.length === 0) {
    throw new Error("No organizations found.");
  }

  if (orgs.length === 1) {
    client.setOrgId(orgs[0]!.id);
    await saveCliOrgId(orgs[0]!.id);
    return orgs[0]!.id;
  }

  throw new Error(
    [
      "Multiple organizations are available.",
      "Pass --org <id> (or set NAKAMA_ORG_ID).",
      "",
      ...orgs.map((org) => `  ${org.id}  ${org.name}`),
    ].join("\n"),
  );
}

async function assertOrgMembership(client: NakamaClient, orgRef: string): Promise<string> {
  const { orgs } = await client.listUserOrgs();
  const normalized = orgRef.trim().toLowerCase();
  const match = orgs.find(
    (org) => org.id === orgRef || org.slug.toLowerCase() === normalized,
  );

  if (!match) {
    throw new Error(`Unknown organization: ${orgRef}`);
  }

  return match.id;
}
