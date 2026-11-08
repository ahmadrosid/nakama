import { AgentGroupsClient } from "./client-agent-groups";

export class NakamaClient extends AgentGroupsClient {
  /**
   * Independent request scope; changing its org never changes the parent
   * client. Without an argument the scope starts in the parent's org.
   */
  forOrg(orgId: string | null = this.orgId): NakamaClient {
    return new NakamaClient({
      authToken: this.authToken ?? undefined,
      baseUrl: this.baseUrl,
      clientOrigin: this.clientOrigin ?? undefined,
      credentials: this.credentials,
      fetch: this.fetchImpl,
      orgId,
    });
  }
}
