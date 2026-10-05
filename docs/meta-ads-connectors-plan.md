# Connectors page and Meta Ads MCP plan

## Goal

Let a Nakama member connect Meta Ads, review performance, and make approved ad changes from chat. Give external account connections one **Connectors** page.

## Current evidence

- Meta announced Ads AI Connectors in open beta for creating, managing, and analyzing campaigns. Nakama has not tested an authorized Meta MCP session. [Meta announcement](https://about.fb.com/news/2026/05/from-scroll-to-chat-to-cart-trends-reshaping-how-india-shops/amp/) · [Meta setup guide](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-get-started)
- Meta's public OAuth metadata advertises authorization code, refresh tokens, PKCE, and an app registration endpoint. Meta's setup guide says a product integration needs a Meta developer app ID and a registered callback URL. The unauthenticated MCP endpoint returns 401. We have not verified that dynamic client registration works for Nakama.
- Meta's [tool reference](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-tools-ad-creation-and-management) names `ads_get_ad_accounts`, `ads_get_ad_entities`, `ads_create_campaign`, `ads_create_ad_set`, `ads_create_ad`, `ads_update_entity`, and `ads_activate_entity`. It does not publish their input schemas. The live tool list remains required before mapping operations.
- Nakama's HTTP MCP server record holds one OAuth grant or bearer header. Assigned profiles share that connection. Its sign-in flow depends on dynamic client registration. See `apps/server/src/services/mcp-service.ts`, `apps/server/src/services/mcp-oauth.ts`, and `docs/website/content/docs/mcp.mdx`.
- The generic MCP bridge exposes every cached tool on an assigned server. It has no action filter or write approval. See `apps/server/src/services/mcp-tool-bridge.ts`.
- Composio has org-scoped, per-member connections. Its channel bridge can map a local client to the earliest org admin. That fallback is not safe for Meta Ads. See `apps/server/src/services/composio-service.ts`.
- Control center puts Composio under **Integrations** and MCP under **Agent tools**. See `apps/web/src/pages/CustomizePage.tsx`.

## Product shape

Add **Control center → Connectors** at `/customize/connections/connectors`. Put a Meta Ads card there. Show connection state, the Meta identity and ad accounts returned by Meta, and the agents with access. Let an org admin enable Meta and assign agents. Let each member connect, reconnect, or disconnect only their own Meta account. Preserve the existing Composio and MCP pages; link to both from Connectors. Keep notifications and other settings where they are.

Use the existing org and profile model. A member proposes ad accounts from their Meta connection. An org admin approves the proposed account IDs for that member and org. The server checks that approval on every call. An admin sees only proposed accounts, not the member's full Meta account list. A member cannot make another member's connection available to an agent.

The first release supports **web chat only**. Telegram, WhatsApp, Discord, CLI, and unattended automations have no verified human member identity for this connection. Do not resolve Meta tools on those paths. Add them later only with an explicit member identity and the same access checks.

## Work plan

### 1. Prove the Meta MCP path

Test `https://mcp.facebook.com/ads` with an authorized test ad account. Record the live tool names, input schemas, auth method, scopes, account identity, and beta limits. Check Nakama's OAuth flow. If Meta rejects dynamic client registration, verify whether a registered Meta client can work with Nakama's callback. Do not store a personal bearer token as a shared MCP header. If the test account lacks beta access, show **Unavailable** on the Meta card and keep the integration disabled. Do not claim a working connector or substitute Composio without a new decision.

### 2. Add member-owned connection and access

Store Meta grants by `orgId` and `userId`, outside the shared MCP server record. Protect tokens at rest, redact them from API responses and logs, and remove them on disconnect. Bind OAuth state and callback to the initiating org and member. Reuse the existing MCP client and Composio connection patterns where they fit.

Resolve a Meta connection only from an authenticated web chat member in the active org. Check current org membership, enablement, agent assignment, the member's connection, and approved ad account on every tool call. Key live MCP sessions by org and member so one member cannot reuse another member's session. Fail closed when a grant expires or Meta revokes it. Remove account approvals when the member disconnects or leaves the org.

### 3. Build the Connectors page

Add one route and one Control center entry. Org admins and members can open it; viewers cannot. Enforce roles in API routes as well as the page. Reuse current cards and query hooks where possible. Show **Unavailable**, **Not connected**, **Connected**, **Reconnect required**, and **Error** states. Show only proposed account names and IDs to org admins; never reveal a token or the full private account list. Let admins approve or remove proposed accounts. Keep old Composio and MCP URLs working.

### 4. Ship read and review

Use Meta account discovery only in the member's Connectors page so the member can propose accounts. Expose fixed agent operations for campaign listing and dated insights. Map each operation to a verified Meta MCP tool. Do not expose Meta's raw tool list to the agent. Check the tool name and schema at connection time, and block the operation if Meta changes either in an unsafe way. Check account IDs against approved accounts. Resolve an object's owning ad account from Meta before any object-level call. Do not route this managed connection through the generic MCP tool bridge.

Show the ad account, currency, date range, and attribution setting with each report. Label conversions and return on ad spend only after checking Meta's live field meaning. Do not compare different attribution settings as if they were equal.

### 5. Ship approved ad changes

Add create, edit, pause, resume, and budget changes only after the read path works. Define one fixed operation for each verified Meta action. If Meta's live MCP lacks a named action, mark it unsupported and resolve that scope gap before claiming the work is done. Do not expose arbitrary MCP calls, deletion, audience upload, or catalog changes.

Before each write, show the org, ad account, target object or parent, current value when one exists, proposed value, and any budget effect. An authenticated human member must approve the exact operation in the web UI; chat text and agent tool calls cannot approve it. The server binds a single-use approval to the actor, org, account, target, action, and values; it rejects changed or expired approvals. Recheck the current value and permissions just before the call. Record the approver, request ID, and Meta result. If a write times out after submission, check Meta's state before any retry. Never repeat a write with an unknown result.

### 6. Verify and document

Test org isolation, member isolation, agent assignment, account approval, OAuth callback binding, revoked grants, channel exclusion, and raw tool rejection. Test approval rejection, changed inputs, stale current values, duplicate requests, unknown write results, and Meta errors. Run a live read and one approved paused-object change on a test ad account. Update user docs with the Connectors path, roles, and connection states.

## Completion checks

- A member connects Meta on Connectors and proposes ad accounts. An org admin approves the accounts that an agent may use.
- An assigned agent reports live campaign data with a date range, currency, and attribution setting.
- Another org, another member, an unassigned agent, and an excluded channel cannot use that grant.
- The managed connector rejects a raw Meta MCP action, an unapproved account, and every write without matching web approval.
- Each named change passes an approval and rejection test. Live tests create a paused object, edit it, change its budget, pause it, and resume only a safe test object.
- A revoked grant prompts reconnection. Existing Composio and MCP routes still work.

## Open checks before code

- Meta's live auth, beta access, input schemas, and account identity remain unverified in Nakama. A Meta app ID and authorized test ad account are required for this check.
- Confirm Meta's app registration and token storage rules before choosing the grant flow.
- Confirm Meta's insight fields and whether the chosen write actions can be tested on paused objects.
