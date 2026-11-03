import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { AgentService } from "../../services/agent-service";
import {
  computerTokenPayload,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";
import { ManagedSecrets } from "../../services/managed-secrets";
import { NAKAMA_CLOUD_PROVIDER_ID, useNakamaCloudSignIn } from "./index";

const servers: Array<{ stop: (force?: boolean) => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }

  useNakamaCloudSignIn(null);
});

const tokenBodySchema = z.object({
  computerId: z.string(),
  confirmCode: z.string().optional(),
  nonce: z.string(),
  signature: z.string(),
  timestamp: z.number(),
});

/** A fake cloud that keeps the enrolled key and checks it on token requests. */
interface FakeCloudOptions {
  modelsStatus?: number;
  /** Runs while the models request is open, for example a Cancel. */
  onModels?: () => Promise<void>;
}

function fakeCloud(options: FakeCloudOptions = {}) {
  const enrolled = new Map<string, string>();
  const confirmCodes: Array<string | null> = [];
  const removed: string[] = [];

  const models = [
    {
      default: true,
      id: "gpt-4o-mini",
      name: "GPT-4o mini",
      providerId: "openai-main",
    },
  ];

  const server = Bun.serve({
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (pathname === LLM_TOKEN_PATH) {
        const body = tokenBodySchema.parse(await request.json());
        const key = enrolled.get(body.computerId);
        confirmCodes.push(body.confirmCode ?? null);

        const publicKey = key
          ? createPublicKey({
              format: "der",
              key: Buffer.concat([
                Buffer.from("302a300506032b6570032100", "hex"),
                Buffer.from(key, "base64"),
              ]),
              type: "spki",
            })
          : null;

        const signed =
          publicKey &&
          verify(
            null,
            computerTokenPayload(body, {
              method: "POST",
              path: LLM_TOKEN_PATH,
            }),
            publicKey,
            Buffer.from(body.signature, "base64")
          );

        return signed
          ? Response.json({ expiresAt: Date.now() + 900_000, pass: "pass-1" })
          : Response.json({ error: "Sign in again." }, { status: 401 });
      }

      if (pathname === "/v1/llm/computer" && request.method === "DELETE") {
        removed.push(request.headers.get("authorization") ?? "");

        return new Response(null, { status: 204 });
      }

      if (pathname === "/v1/llm/models") {
        await options.onModels?.();

        if (options.modelsStatus) {
          return Response.json(
            { error: "Your team turned off Nakama Desktop for its models." },
            { status: options.modelsStatus }
          );
        }

        return Response.json({ models });
      }

      return new Response("Not found", { status: 404 });
    },
    port: 0,
  });

  servers.push(server);

  return {
    confirmCodes,
    enrolled,
    models,
    removed,
    url: `http://127.0.0.1:${server.port}`,
  };
}

async function setup(cloudOptions: FakeCloudOptions = {}) {
  process.env.NAKAMA_CONFIG_DIR = await mkdtemp(
    join(tmpdir(), "nakama-cloud-sign-in-")
  );

  const db = createInMemoryDatabaseAdapter();
  const secrets = new ManagedSecrets(db, randomBytes(32).toString("base64"));
  const agent = new AgentService(null, null, db, undefined, secrets);

  return { agent, cloud: fakeCloud(cloudOptions) };
}

test("the browser connects this computer, and Nakama Cloud becomes the default provider", async () => {
  const { agent, cloud } = await setup();

  const { connectUrl } = await agent.startNakamaCloudSignIn({
    cloudUrl: cloud.url,
    computerName: "Ada's MacBook",
  });

  // Play the browser on the Connect page.
  const link = new URL(connectUrl);
  expect(link.origin).toBe(cloud.url);
  expect(link.pathname).toBe("/desktop/connect");
  expect(link.searchParams.get("name")).toBe("Ada's MacBook");
  cloud.enrolled.set("computer_1", link.searchParams.get("key") ?? "");

  const back = new URL(link.searchParams.get("return") ?? "");
  expect(back.hostname).toBe("127.0.0.1");

  const wrong = new URL(back);
  wrong.searchParams.set("state", "not-the-state");
  wrong.searchParams.set("computerId", "computer_1");
  wrong.searchParams.set("confirmCode", "code-from-the-cloud-0001");
  expect((await fetch(wrong)).status).toBe(400);

  back.searchParams.set("state", link.searchParams.get("state") ?? "");
  back.searchParams.set("computerId", "computer_1");
  back.searchParams.set("confirmCode", "code-from-the-cloud-0001");
  back.searchParams.set("orgId", "org_acme");
  back.searchParams.set("orgName", "Acme");
  back.searchParams.set("account", "ada@example.com");
  expect((await fetch(back)).status).toBe(200);
  // The first token request carries the Connect code.
  expect(cloud.confirmCodes[0]).toBe("code-from-the-cloud-0001");

  expect(agent.nakamaCloudStatus()).toEqual({
    account: "ada@example.com",
    cloudUrl: cloud.url,
    orgName: "Acme",
    signedIn: true,
  });

  const { providers } = await agent.listProviders();
  expect(providers.map((provider) => provider.id)).toEqual([
    NAKAMA_CLOUD_PROVIDER_ID,
  ]);

  // The one-time address is closed after use.
  await expect(fetch(back)).rejects.toThrow();
});

test("signing in again keeps the same device key, and sign out removes the provider", async () => {
  const { agent, cloud } = await setup();

  const first = new URL(
    (await agent.startNakamaCloudSignIn({ cloudUrl: cloud.url })).connectUrl
  );

  const second = new URL(
    (await agent.startNakamaCloudSignIn({ cloudUrl: cloud.url })).connectUrl
  );

  expect(second.searchParams.get("key")).toBe(first.searchParams.get("key"));
  expect(second.searchParams.get("install")).toBe(
    first.searchParams.get("install")
  );
  expect(second.searchParams.get("state")).not.toBe(
    first.searchParams.get("state")
  );

  await agent.signOutNakamaCloud();
  expect(agent.nakamaCloudStatus().signedIn).toBe(false);
});

/** Play the browser: enroll the key and build the Connect result address. */
function connectResult(
  cloud: ReturnType<typeof fakeCloud>,
  connectUrl: string
): URL {
  const link = new URL(connectUrl);
  cloud.enrolled.set("computer_1", link.searchParams.get("key") ?? "");

  const back = new URL(link.searchParams.get("return") ?? "");
  back.searchParams.set("state", link.searchParams.get("state") ?? "");
  back.searchParams.set("computerId", "computer_1");
  back.searchParams.set("confirmCode", "code-from-the-cloud-0001");

  return back;
}

test("a sign-in that cannot load the team's models does not sign in", async () => {
  const { agent, cloud } = await setup({ modelsStatus: 403 });

  const back = connectResult(
    cloud,
    (await agent.startNakamaCloudSignIn({ cloudUrl: cloud.url })).connectUrl
  );

  expect((await fetch(back)).status).toBe(502);
  expect(agent.nakamaCloudStatus().signedIn).toBe(false);
});

test("a Connect after sign out (Cancel on the first launch page) does nothing", async () => {
  const { agent, cloud } = await setup();

  const back = connectResult(
    cloud,
    (await agent.startNakamaCloudSignIn({ cloudUrl: cloud.url })).connectUrl
  );

  await agent.signOutNakamaCloud();

  await expect(fetch(back)).rejects.toThrow();
  expect(agent.nakamaCloudStatus().signedIn).toBe(false);
});

test("the team's model list is reloaded from the cloud, at most every few minutes", async () => {
  const { agent, cloud } = await setup();

  const back = connectResult(
    cloud,
    (await agent.startNakamaCloudSignIn({ cloudUrl: cloud.url })).connectUrl
  );

  expect((await fetch(back)).status).toBe(200);

  const savedModels = async () =>
    (await agent.listProviders()).providers
      .find((provider) => provider.id === NAKAMA_CLOUD_PROVIDER_ID)
      ?.customModels?.map((model) => model.id);

  // An admin adds a model in the cloud.
  cloud.models.push({
    default: false,
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    providerId: "anthropic-main",
  });

  // Just signed in: the list is fresh, so no reload yet.
  await agent.getModels();
  await Bun.sleep(50);
  expect(await savedModels()).toEqual(["openai-main::gpt-4o-mini"]);

  setSystemTime(new Date(Date.now() + 6 * 60 * 1000));

  try {
    await agent.getModels();
    await Bun.sleep(50);
    expect(await savedModels()).toEqual([
      "openai-main::gpt-4o-mini",
      "anthropic-main::claude-sonnet-4-5",
    ]);
  } finally {
    setSystemTime();
  }
});

test("a Cancel while the models load removes the just-activated computer in the cloud", async () => {
  let cancel = () => Promise.resolve();
  const { agent, cloud } = await setup({ onModels: () => cancel() });
  cancel = () => agent.signOutNakamaCloud();

  const back = connectResult(
    cloud,
    (await agent.startNakamaCloudSignIn({ cloudUrl: cloud.url })).connectUrl
  );

  expect((await fetch(back)).status).toBe(400);
  expect(agent.nakamaCloudStatus().signedIn).toBe(false);
  expect(cloud.removed).toEqual(["Bearer pass-1"]);
});
