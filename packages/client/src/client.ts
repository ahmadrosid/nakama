import { AgentGroupsClient } from "./client-agent-groups";

export class NakamaClient extends AgentGroupsClient {
  /** Independent request scope; changing its org never changes the parent client. */
  forOrg(orgId: string | null): NakamaClient {
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
