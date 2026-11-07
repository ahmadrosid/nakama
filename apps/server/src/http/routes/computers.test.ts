import { expect, setSystemTime, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import {
  ComputerAuthService,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";
import { testDeviceKey } from "../../testing/computer-device";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";

const listSchema = z.object({
  computers: z.array(z.object({ id: z.string(), name: z.string() })),
});

async function setup() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const computerAuth = new ComputerAuthService(databaseAdapter);

  const { app, authService } = createMinimalHonoApp({
    computerAuth,
    databaseAdapter,
  });

  const ada = await seedOrgAdmin(databaseAdapter, {
    authService,
    email: "ada@example.com",
    role: "member",
    userId: "user_ada",
  });

  const bob = await seedOrgAdmin(databaseAdapter, {
    authService,
    email: "bob@example.com",
    orgId: ada.orgId,
    role: "member",
    userId: "user_bob",
  });

  const adaSession = await loginUserSession(
    app,
    ada.email,
    ada.password,
    ada.orgId
  );

  const bobSession = await loginUserSession(
    app,
    bob.email,
    bob.password,
    ada.orgId
  );

  const call = (
    session: typeof adaSession,
    path: string,
    init: { body?: string; method?: string } = {}
  ) =>
    app.request(`http://localhost:4310${path}`, {
      ...init,
      headers: session.headers({
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
      }),
    });

  return {
    adaSession,
    app,
    bobSession,
    call,
    databaseAdapter,
    orgId: ada.orgId,
  };
}

test("a member enrolls this computer, sees it in the list once it confirms, and removes it", async () => {
  const { adaSession, app, call } = await setup();
  const key = testDeviceKey();

  const enrolled = await call(adaSession, "/v1/computers", {
    body: JSON.stringify({
      installId: "install_0001",
      name: "Ada's MacBook",
      publicKey: key.publicKey,
    }),
    method: "POST",
  });

  expect(enrolled.status).toBe(201);

  const { computerId, confirmCode } = z
    .object({ computerId: z.string(), confirmCode: z.string() })
    .parse(await enrolled.json());

  // Not confirmed yet: not a connected computer.
  expect(
    listSchema.parse(await (await call(adaSession, "/v1/computers")).json())
      .computers
  ).toEqual([]);

  // The desktop confirms with the code from the Connect result.
  const confirmed = await app.request(LLM_TOKEN_PATH, {
    body: JSON.stringify(key.signRequest(computerId, { confirmCode })),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(confirmed.status).toBe(200);

  const listed = listSchema.parse(
    await (await call(adaSession, "/v1/computers")).json()
  );

  expect(listed.computers).toEqual([
    expect.objectContaining({ id: computerId, name: "Ada's MacBook" }),
  ]);

  expect(
    (
      await call(adaSession, `/v1/computers/${computerId}`, {
        method: "DELETE",
      })
    ).status
  ).toBe(204);
  expect(
    listSchema.parse(await (await call(adaSession, "/v1/computers")).json())
      .computers
  ).toEqual([]);
});

test("a bad key is refused, and one member cannot remove another member's computer", async () => {
  const { adaSession, bobSession, call } = await setup();

  expect(
    (
      await call(adaSession, "/v1/computers", {
        body: JSON.stringify({
          installId: "install_0001",
          name: "Ada's MacBook",
          publicKey: "not-a-key",
        }),
        method: "POST",
      })
    ).status
  ).toBe(400);

  const enrolled = await call(adaSession, "/v1/computers", {
    body: JSON.stringify({
      installId: "install_0001",
      name: "Ada's MacBook",
      publicKey: testDeviceKey().publicKey,
    }),
    method: "POST",
  });

  const { computerId } = z
    .object({ computerId: z.string() })
    .parse(await enrolled.json());

  expect(
    (
      await call(bobSession, `/v1/computers/${computerId}`, {
        method: "DELETE",
      })
    ).status
  ).toBe(404);
  expect(
    listSchema.parse(await (await call(bobSession, "/v1/computers")).json())
      .computers
  ).toEqual([]);
});

test("Connect is refused when the team turned off Nakama Desktop", async () => {
  const { adaSession, call, databaseAdapter, orgId } = await setup();
  const org = await databaseAdapter.getOrganizationById(orgId);

  if (!org) {
    throw new Error("org missing");
  }

  await databaseAdapter.upsertOrganization({
    ...org,
    desktopModelsEnabled: false,
  });

  const enrolled = await call(adaSession, "/v1/computers", {
    body: JSON.stringify({
      installId: "install_0001",
      name: "Ada's MacBook",
      publicKey: testDeviceKey().publicKey,
    }),
    method: "POST",
  });

  expect(enrolled.status).toBe(403);
  expect(
    listSchema.parse(await (await call(adaSession, "/v1/computers")).json())
      .computers
  ).toEqual([]);
});

test("connecting a computer needs a sign-in from the last few minutes", async () => {
  const { adaSession, call } = await setup();

  setSystemTime(new Date(Date.now() + 11 * 60 * 1000));

  try {
    const enrolled = await call(adaSession, "/v1/computers", {
      body: JSON.stringify({
        installId: "install_0001",
        name: "Ada's MacBook",
        publicKey: testDeviceKey().publicKey,
      }),
      method: "POST",
    });

    expect(enrolled.status).toBe(401);
    // The session itself still works: only connecting needs a fresh sign-in.
    expect((await call(adaSession, "/v1/computers")).status).toBe(200);
  } finally {
    setSystemTime();
  }
});
