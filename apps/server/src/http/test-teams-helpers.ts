import { createMinimalHonoApp } from "./test-app-helpers";
import {
  type AppFetch,
  loginUserSession,
  seedOrgAdmin,
} from "./test-session-helpers";

export const PROFILE_ID = "agent_teams";

/** An agent a member owns, which members may otherwise manage themselves. */
export const MEMBER_PROFILE_ID = "agent_member";

export const CREDENTIALS = {
  allowedUserIds: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "teams-secret",
  tenantId: "33333333-3333-4333-8333-333333333333",
};

/** The save path asks Microsoft for a token; only that call is stubbed. */
export async function withTokenEndpointStubbed<T>(
  run: () => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;

  // SAFETY: The stub takes the same inputs as fetch and delegates everything
  // that is not the Microsoft token endpoint to the real one.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input instanceof Request ? input.url : input).startsWith(
      "https://login.microsoftonline.com/"
    )
      ? Response.json({ access_token: "token", token_type: "Bearer" })
      : // SAFETY: Narrowed from the fetch input union the caller passed in.
        original(input as RequestInfo, init)) as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export interface Owner {
  orgId: string;
  profileId: string;
}

export async function setupOwnedProfile() {
  const workerCalls: string[] = [];

  // The owner check reads the agent, so the harness needs one that answers.
  // The worker manager records what it is asked, and runs a save the way the
  // real one does between stopping and restarting the worker.
  const { app, authService, databaseAdapter } = createMinimalHonoApp({
    agent: {
      getProfile: async (_orgId: string, id: string) => ({
        profile: {
          id,
          isSuper: false,
          ownerUserId: id === MEMBER_PROFILE_ID ? "user_member" : "user_admin",
        },
      }),
      listProfiles: async () => ({ profiles: [{ id: PROFILE_ID }] }),
    },
    workerManager: {
      isValidWorker: () => true,
      saveChannelConfig: async <T>(
        platform: string,
        owner: Owner,
        save: () => Promise<T>
      ) => {
        workerCalls.push(`save:${platform}:${owner.orgId}:${owner.profileId}`);

        return await save();
      },
      startWorker: async (name: string, owner?: Owner) => {
        workerCalls.push(`start:${name}:${owner?.orgId}:${owner?.profileId}`);
      },
    },
  });

  const fetchApp: AppFetch = app;

  await seedOrgAdmin(databaseAdapter, { authService, profileId: PROFILE_ID });

  const admin = await loginUserSession(
    fetchApp,
    "admin@example.com",
    "password123"
  );

  return {
    admin,
    app,
    databaseAdapter,
    fetchApp,
    profileId: PROFILE_ID,
    workerCalls,
  };
}

export async function putSettings(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  session: Awaited<ReturnType<typeof loginUserSession>>,
  profileId: string
): Promise<Response> {
  return await app.fetch(
    new Request(
      `http://localhost:4310/v1/settings/teams?profileId=${profileId}`,
      {
        body: JSON.stringify(CREDENTIALS),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PUT",
      }
    )
  );
}
