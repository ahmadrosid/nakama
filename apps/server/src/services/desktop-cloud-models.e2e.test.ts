/**
 * End to end: Nakama Desktop runs the agent and its tools on this computer,
 * and Nakama Cloud runs the model turns with the org's provider. Both
 * servers are real and run in this process; only the model vendor is fake.
 */
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfileSoulDir, type UserConfig } from "@nakama/core";
import { BASH_TOOL_ID } from "@nakama/core/tools/protected";
import {
  createInMemoryDatabaseAdapter,
  ensureBashToolDefinition,
} from "@nakama/db";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../http/test-session-helpers";
import { NAKAMA_CLOUD_PROVIDER_ID } from "../providers/nakama-cloud";
import { AgentService } from "./agent-service";
import { AuthService } from "./auth-service";
import { ComputerAuthService, LLM_TOKEN_PATH } from "./computer-auth";
import { LlmUsageTracker } from "./llm-usage-tracker";
import { ManagedSecrets } from "./managed-secrets";
import { OrgService } from "./org-service";

/** Each vendor call: a bash tool call when the chat has none yet, else text. */
const vendor = setupServer(
  http.post(
    "https://api.openai.com/v1/chat/completions",
    async ({ request }) => {
      const body = z
        .object({ messages: z.array(z.object({ role: z.string() })) })
        .parse(await request.json());

      const toolDone = body.messages.some((message) => message.role === "tool");

      const chunks = toolDone
        ? [{ choices: [{ delta: { content: "Done." }, index: 0 }] }]
        : [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        function: {
                          arguments: JSON.stringify({
                            command: "echo hello > hello.txt",
                          }),
                          name: "bash",
                        },
                        id: "call_1",
                        index: 0,
                        type: "function",
                      },
                    ],
                  },
                  index: 0,
                },
              ],
            },
          ];

      const frames = [
        ...chunks,
        {
          choices: [
            {
              delta: {},
              finish_reason: toolDone ? "stop" : "tool_calls",
              index: 0,
            },
          ],
        },
        {
          choices: [],
          usage: { completion_tokens: 5, prompt_tokens: 50, total_tokens: 55 },
        },
      ];

      return new HttpResponse(
        `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } }
      );
    }
  )
);

// Only the two local servers may be reached for real; any other call fails.
beforeAll(() =>
  vendor.listen({
    onUnhandledRequest: (request, print) => {
      if (new URL(request.url).hostname !== "127.0.0.1") {
        print.error();
      }
    },
  })
);

afterAll(() => vendor.close());

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const enrollSchema = z.object({
  computerId: z.string(),
  confirmCode: z.string(),
});

async function setup() {
  // The cloud: an org with an OpenAI provider, an admin and a member.
  const cloudDb = createInMemoryDatabaseAdapter();
  const authService = new AuthService();

  const cloudConfig: UserConfig = {
    defaultProviderId: "openai-main",
    providers: [
      {
        apiKey: "sk-test-not-real",
        createdAt: new Date().toISOString(),
        // The team's one model, so turns use chat/completions (faked below).
        customModels: [
          { default: true, id: "gpt-4o-mini", name: "GPT-4o mini" },
        ],
        id: "openai-main",
        label: "OpenAI",
        type: "openai",
      },
    ],
  };

  const cloudAgent = new AgentService(
    cloudConfig,
    null,
    cloudDb,
    new LlmUsageTracker(cloudDb)
  );

  const { app } = createMinimalHonoApp({
    agent: cloudAgent,
    authService,
    computerAuth: new ComputerAuthService(cloudDb),
    databaseAdapter: cloudDb,
  });

  const cloud = Bun.serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  servers.push(cloud);
  const cloudUrl = `http://127.0.0.1:${cloud.port}`;

  const member = await seedOrgAdmin(cloudDb, {
    authService,
    email: "ada@example.com",
    role: "member",
    userId: "user_ada",
  });

  const session = await loginUserSession(
    app,
    member.email,
    member.password,
    member.orgId
  );

  // The computer: its own data folder, secrets store and database.
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-desktop-e2e-")
  );

  const localDb = createInMemoryDatabaseAdapter();

  const localAgent = new AgentService(
    null,
    null,
    localDb,
    undefined,
    new ManagedSecrets(localDb, randomBytes(32).toString("base64"))
  );

  const local = await seedOrgAdmin(localDb, {
    orgId: "org_local",
    profileId: "profile_local",
    userId: "user_local",
  });

  // The chat uses the team's default model through Nakama Cloud.
  const profile = await localDb.getProfile("profile_local");

  if (!profile) {
    throw new Error("The local profile is missing.");
  }

  await localDb.upsertProfile({
    ...profile,
    model: null,
  });

  await ensureBashToolDefinition(localDb);
  await localDb.assignToolToProfile("profile_local", BASH_TOOL_ID);

  /** Plays the browser: Connect on the cloud, then back to 127.0.0.1. */
  const signIn = async () => {
    const link = new URL(
      (
        await localAgent.startNakamaCloudSignIn({
          cloudUrl,
          computerName: "Ada's MacBook",
        })
      ).connectUrl
    );

    const enrolled = await app.request(`${cloudUrl}/v1/computers`, {
      body: JSON.stringify({
        installId: link.searchParams.get("install"),
        name: link.searchParams.get("name"),
        publicKey: link.searchParams.get("key"),
      }),
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
      method: "POST",
    });

    const { computerId, confirmCode } = enrollSchema.parse(
      await enrolled.json()
    );

    const back = new URL(link.searchParams.get("return") ?? "");

    return {
      callback: (state: string) => {
        const url = new URL(back);
        url.search = new URLSearchParams({
          account: member.email,
          computerId,
          confirmCode,
          orgId: member.orgId,
          orgName: "Test Org",
          state,
        }).toString();

        return fetch(url);
      },
      computerId,
      state: link.searchParams.get("state") ?? "",
    };
  };

  const chat = async (message: string) => {
    const sessionId = await localAgent.createSession(
      local.orgId,
      "web",
      "profile_local",
      local.userId,
      { orgRole: "admin" }
    );

    const turn = await localAgent.turns.start(sessionId, local.orgId, {
      message,
    });

    if (turn.status !== "started") {
      throw new Error(`The turn did not start: ${turn.status}`);
    }

    return turn.done;
  };

  return {
    app,
    chat,
    cloudDb,
    cloudUrl,
    localAgent,
    member,
    orgService: new OrgService(cloudDb, authService),
    session,
    signIn,
  };
}

test("sign in from the browser, then the local agent runs bash here with the team's model", async () => {
  const { chat, cloudDb, localAgent, member, signIn } = await setup();

  // 1. Connect, then the browser comes back to 127.0.0.1.
  const connect = await signIn();
  expect((await connect.callback("not-the-state")).status).toBe(400);
  expect((await connect.callback(connect.state)).status).toBe(200);

  const { providers, defaultProviderId } = await localAgent.listProviders();
  expect(defaultProviderId).toBe(NAKAMA_CLOUD_PROVIDER_ID);
  expect(providers.map((provider) => provider.id)).toEqual([
    NAKAMA_CLOUD_PROVIDER_ID,
  ]);

  // 2. A local turn: the cloud model asks for bash, the tool runs here.
  expect(await chat("Write hello.txt")).toMatchObject({ kind: "done" });
  expect(
    await readFile(
      join(getProfileSoulDir("org_local", "profile_local"), "hello.txt"),
      "utf8"
    )
  ).toBe("hello\n");

  // 3. The cloud billed both model calls to the member.
  const actors = await cloudDb.listLlmUsageStatsByActor(member.orgId);
  expect(
    actors.find((actor) => actor.userId === member.userId)?.requestCount
  ).toBe(2);
});

test("a removed computer must sign in again, and an org that turns desktop off refuses turns", async () => {
  const { app, chat, member, orgService, session, signIn } = await setup();

  const first = await signIn();
  await first.callback(first.state);
  expect(await chat("Write hello.txt")).toMatchObject({ kind: "done" });

  // 4. Remove the computer in cloud Settings: the next turn needs a sign-in.
  const removed = await app.request(`/v1/computers/${first.computerId}`, {
    headers: session.headers({ "X-CSRF-Token": session.csrfToken }),
    method: "DELETE",
  });

  expect(removed.status).toBe(204);
  expect(await chat("Again")).toMatchObject({ kind: "error", status: 401 });

  // 5. Desktop off: sign-in works, turns are refused; on again, turns work.
  await orgService.updateOrganization(member.orgId, {
    desktopModelsEnabled: false,
  });
  const second = await signIn();
  expect((await second.callback(second.state)).status).toBe(200);
  expect(await chat("Again")).toMatchObject({ kind: "error", status: 403 });

  await orgService.updateOrganization(member.orgId, {
    desktopModelsEnabled: true,
  });
  expect(await chat("Again")).toMatchObject({ kind: "done" });
});

test("the cloud refuses a reused nonce and an old timestamp from a real computer", async () => {
  const { cloudUrl } = await setup();

  // Unknown computer and bad signature: the token route says sign in again.
  const refused = await fetch(`${cloudUrl}${LLM_TOKEN_PATH}`, {
    body: JSON.stringify({
      computerId: "computer_unknown",
      nonce: "nonce-0000000000000001",
      signature: "AAAA",
      timestamp: Date.now() - 10 * 60 * 1000,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(refused.status).toBe(401);
});
