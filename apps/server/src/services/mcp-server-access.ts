import type { DatabaseAdapter, StoredMcpServerRecord } from "@nakama/db";

export interface McpServerResolutionOptions {
  /**
   * Platform admins own every install-wide MCP server and may attach one to
   * any profile, which is what `POST /v1/profiles/:profileId/mcp-servers`
   * already does. Pack import applies the identical policy.
   */
  isPlatformAdmin?: boolean;
}

/**
 * MCP servers are install-wide: only a platform admin can create one, and the
 * only other route that reaches a server is the platform-admin-only profile
 * assignment endpoint. So "already assigned to a profile in this org" is the
 * platform admin's explicit grant to that organization.
 *
 * Anything running with org-admin rights — profile-pack import above all — must
 * resolve MCP names through this policy instead of the unscoped name lookup,
 * otherwise a pack can name any install-wide server and hand the importing org
 * its headers, OAuth grant, stdio command, and cached tools.
 */
export async function findMcpServerForOrg(
  db: DatabaseAdapter,
  orgId: string,
  name: string,
  options: McpServerResolutionOptions = {}
): Promise<StoredMcpServerRecord | null> {
  const server = await db.getMcpServerByName(name);

  if (!server || options.isPlatformAdmin) {
    return server;
  }

  const profiles = await db.listProfilesForMcpServer(server.id);

  return profiles.some((profile) => profile.orgId === orgId) ? server : null;
}
