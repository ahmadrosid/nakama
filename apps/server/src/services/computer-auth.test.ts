import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { seedOrgAdmin } from "../http/test-session-helpers";
import { NakamaCloudPasses } from "../providers/nakama-cloud/passes";
import { testDeviceKey } from "../testing/computer-device";
import {
  COMPUTER_PASS_TTL_MS,
  ComputerAuthService,
  type ComputerTokenRequest,
  isEd25519PublicKey,
  LLM_TOKEN_PATH,
} from "./computer-auth";
import { ManagedSecrets } from "./managed-secrets";

const passResponseSchema = z.object({
  expiresAt: z.number(),
  pass: z.string(),
});

async function setup() {
  let time = Date.parse("2026-11-03T10:00:00.000Z");
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const auth = new ComputerAuthService(databaseAdapter, () => time);
  const { app } = createMinimalHonoApp({ computerAuth: auth, databaseAdapter });

  const { orgId, userId } = await seedOrgAdmin(databaseAdapter, {
    role: "member",
  });

  const key = testDeviceKey();

  const enrolled = await auth.enroll({
    installId: "install_1",
    name: "Ada's MacBook",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

  if (!enrolled) {
    throw new Error("enroll refused");
  }

  const { computer, confirmCode } = enrolled;

  const signedRequest = (
    overrides: { confirmCode?: string; nonce?: string; timestamp?: number } = {}
  ) => key.signRequest(computer.id, { timestamp: time, ...overrides });

  const requestPass = (body: ComputerTokenRequest) =>
    app.request(LLM_TOKEN_PATH, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

  // The app sends the code from the Connect result once.
  expect((await requestPass(signedRequest({ confirmCode }))).status).toBe(200);

  return {
    advance: (ms: number) => {
      time += ms;
    },
    app,
    auth,
    computer,
    databaseAdapter,
    key,
    orgId,
    requestPass,
    signedRequest,
    timestamp: () => time,
    userId,
  };
}

describe("computer passes", () => {
  test("a signed request gets a pass that opens model access for that computer", async () => {
    const {
      auth,
      computer,
      databaseAdapter,
      orgId,
      requestPass,
      signedRequest,
      userId,
    } = await setup();

    const response = await requestPass(signedRequest());
    const body = passResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(await auth.verifyPass(body.pass)).toMatchObject({ orgId, userId });
    expect(
      (await databaseAdapter.getComputer(computer.id))?.lastSeenAt
    ).not.toBeNull();
  });

  test("a pass stops working after 15 minutes", async () => {
    const { advance, auth, requestPass, signedRequest } = await setup();

    const { pass } = passResponseSchema.parse(
      await (await requestPass(signedRequest())).json()
    );

    advance(COMPUTER_PASS_TTL_MS + 1);

    expect(await auth.verifyPass(pass)).toBeNull();
  });

  test("a bad signature, an old time and a reused nonce are refused", async () => {
    const { requestPass, signedRequest } = await setup();
    const good = signedRequest({ nonce: "nonce-reused-0000001" });

    expect(
      (await requestPass({ ...good, signature: signedRequest().signature }))
        .status
    ).toBe(401);
    expect(
      (
        await requestPass(
          signedRequest({ timestamp: Date.parse("2026-11-03T09:57:00.000Z") })
        )
      ).status
    ).toBe(401);
    expect((await requestPass(good)).status).toBe(200);
    expect((await requestPass(good)).status).toBe(401);
  });

  test("a revoked computer loses access, also with a pass it holds", async () => {
    const {
      auth,
      computer,
      databaseAdapter,
      orgId,
      requestPass,
      signedRequest,
      userId,
    } = await setup();

    const { pass } = passResponseSchema.parse(
      await (await requestPass(signedRequest())).json()
    );

    expect(await auth.revoke({ id: computer.id, orgId, userId })).toBe(true);
    expect(await auth.verifyPass(pass)).toBeNull();
    expect((await requestPass(signedRequest())).status).toBe(401);

    const actions = (await databaseAdapter.listAuditEvents({ orgId })).map(
      (event) => event.action
    );

    expect(actions).toContain("computer.enroll");
    expect(actions).toContain("computer.revoke");
  });

  test("a removed member loses their computers, and gets none back when invited again", async () => {
    const {
      auth,
      computer,
      databaseAdapter,
      orgId,
      requestPass,
      signedRequest,
      userId,
    } = await setup();

    const { pass } = passResponseSchema.parse(
      await (await requestPass(signedRequest())).json()
    );

    await databaseAdapter.deleteOrgMember(orgId, userId);
    expect(await auth.verifyPass(pass)).toBeNull();
    expect((await requestPass(signedRequest())).status).toBe(401);

    await databaseAdapter.upsertOrgMember({
      createdAt: new Date().toISOString(),
      orgId,
      role: "member",
      userId,
    });

    expect(await auth.verifyPass(pass)).toBeNull();
    expect((await requestPass(signedRequest())).status).toBe(401);
    expect(
      (await databaseAdapter.getComputer(computer.id))?.revokedAt
    ).not.toBeNull();
  });

  test("each sign-out-everywhere step also ends the user's computers", async () => {
    const {
      auth,
      databaseAdapter,
      key,
      orgId,
      requestPass,
      timestamp,
      userId,
    } = await setup();

    // Password change, admin revoke and MFA setup go through the first two;
    // a password reset has its own transaction.
    const signOutEverywhere = [
      () =>
        databaseAdapter.revokeBrowserSessionsForUser(
          userId,
          new Date().toISOString()
        ),
      () =>
        databaseAdapter.revokeBrowserSessionsForUserExcept(
          userId,
          "session_current",
          new Date().toISOString()
        ),
      async () => {
        await databaseAdapter.createPasswordResetToken({
          consumedAt: null,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          id: "reset_1",
          tokenHash: "reset-hash-1",
          userId,
        });

        expect(
          await databaseAdapter.consumePasswordResetToken(
            "reset-hash-1",
            "new-password-hash",
            new Date().toISOString()
          )
        ).toBe(userId);
      },
    ];

    for (const [index, signOut] of signOutEverywhere.entries()) {
      const enrolled = await auth.enroll({
        installId: `install_step_${index}`,
        name: "Laptop",
        orgId,
        publicKey: key.publicKey,
        userId,
      });

      if (!enrolled) {
        throw new Error("enroll refused");
      }

      const signed = (confirmCode?: string) =>
        key.signRequest(enrolled.computer.id, {
          timestamp: timestamp(),
          ...(confirmCode && { confirmCode }),
        });

      const { pass } = passResponseSchema.parse(
        await (await requestPass(signed(enrolled.confirmCode))).json()
      );

      await signOut();

      expect(await auth.verifyPass(pass)).toBeNull();
      expect((await requestPass(signed())).status).toBe(401);
    }
  });

  test("a disabled user loses access, also with a pass they hold", async () => {
    const { auth, databaseAdapter, requestPass, signedRequest, userId } =
      await setup();

    const { pass } = passResponseSchema.parse(
      await (await requestPass(signedRequest())).json()
    );

    await databaseAdapter.disableUserUnlessLastAdmin(
      userId,
      new Date().toISOString()
    );

    expect(await auth.verifyPass(pass)).toBeNull();
    expect((await requestPass(signedRequest())).status).toBe(401);

    await databaseAdapter.enableUser(userId);
    expect(await auth.verifyPass(pass)).not.toBeNull();
  });

  test("a key from someone else's link is never activated without the Connect code", async () => {
    const { auth, orgId, requestPass, timestamp, userId } = await setup();
    const attacker = testDeviceKey();

    const enrolled = await auth.enroll({
      installId: "install_attacker",
      name: "Work laptop",
      orgId,
      publicKey: attacker.publicKey,
      userId,
    });

    if (!enrolled) {
      throw new Error("enroll refused");
    }

    const { computer, confirmCode } = enrolled;

    expect(
      (
        await requestPass(
          attacker.signRequest(computer.id, { timestamp: timestamp() })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await requestPass(
          attacker.signRequest(computer.id, {
            confirmCode: "x".repeat(32),
            timestamp: timestamp(),
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await requestPass(
          attacker.signRequest(computer.id, {
            confirmCode,
            timestamp: timestamp(),
          })
        )
      ).status
    ).toBe(200);
  });

  test("signing in again from the same install reuses the computer and keeps it working", async () => {
    const { auth, computer, key, orgId, requestPass, signedRequest, userId } =
      await setup();

    const again = await auth.enroll({
      installId: "install_1",
      name: "Ada's Mac",
      orgId,
      publicKey: key.publicKey,
      userId,
    });

    expect(again?.computer).toMatchObject({
      id: computer.id,
      name: "Ada's Mac",
      pendingCodeHash: null,
    });
    // No new Connect code is needed: a replayed link cannot lock it out.
    expect((await requestPass(signedRequest())).status).toBe(200);
  });

  test("a link with another key cannot replace the key of a working computer", async () => {
    const { auth, databaseAdapter, computer, key, orgId, userId } =
      await setup();

    expect(
      await auth.enroll({
        installId: "install_1",
        name: "Ada's MacBook",
        orgId,
        publicKey: testDeviceKey().publicKey,
        userId,
      })
    ).toBeNull();
    expect((await databaseAdapter.getComputer(computer.id))?.publicKey).toBe(
      key.publicKey
    );
  });

  test("an unconfirmed computer takes the key from a new Connect", async () => {
    const { auth, orgId, userId } = await setup();
    const first = testDeviceKey();
    const second = testDeviceKey();

    const pending = await auth.enroll({
      installId: "install_2",
      name: "Laptop",
      orgId,
      publicKey: first.publicKey,
      userId,
    });

    const replaced = await auth.enroll({
      installId: "install_2",
      name: "Laptop",
      orgId,
      publicKey: second.publicKey,
      userId,
    });

    expect(replaced?.computer.id).toBe(pending?.computer.id ?? "");
    expect(replaced?.computer.publicKey).toBe(second.publicKey);
  });

  test("the pass key is kept in the secrets store, so a restart keeps passes valid", async () => {
    const { databaseAdapter, requestPass, signedRequest, timestamp } =
      await setup();

    const secrets = new ManagedSecrets(
      databaseAdapter,
      randomBytes(32).toString("base64")
    );

    const before = new ComputerAuthService(databaseAdapter, timestamp, secrets);
    const after = new ComputerAuthService(databaseAdapter, timestamp, secrets);

    const issued = await before.issuePass(signedRequest(), {
      method: "POST",
      path: LLM_TOKEN_PATH,
    });

    const pass = issued && "pass" in issued ? issued.pass : "";

    expect(pass).not.toBe("");
    expect(await after.verifyPass(pass)).not.toBeNull();
    // The test app's service has no secrets store, so it keeps its own key.
    expect((await requestPass(signedRequest())).status).toBe(200);
  });

  test("only a raw 32-byte Ed25519 key is a public key", () => {
    expect(isEd25519PublicKey(testDeviceKey().publicKey)).toBe(true);
    expect(isEd25519PublicKey(Buffer.alloc(31).toString("base64"))).toBe(false);
    expect(isEd25519PublicKey("not base64!")).toBe(false);
  });
});

/** A real HTTP server on the test app, so the desktop side calls it over fetch. */
function serve(app: {
  fetch: (request: Request) => Response | Promise<Response>;
}) {
  const server = Bun.serve({ fetch: app.fetch, port: 0 });

  return {
    stop: () => server.stop(true),
    url: `http://127.0.0.1:${server.port}`,
  };
}

describe("the desktop side of passes", () => {
  test("a computer whose clock is off takes the cloud's time and still gets a pass", async () => {
    const { app, auth, computer, key, timestamp } = await setup();
    const cloud = serve(app);

    try {
      const passes = new NakamaCloudPasses({
        baseUrl: cloud.url,
        computerId: computer.id,
        // This computer's clock is 5 minutes fast.
        now: () => timestamp() + 5 * 60 * 1000,
        sign: (payload) => Promise.resolve(key.sign(payload)),
      });

      expect(await auth.verifyPass(await passes.get())).not.toBeNull();
      expect(passes.refused).toBe(false);
    } finally {
      cloud.stop();
    }
  });

  test("a computer the cloud refused is marked, and a new Connect clears it", async () => {
    const { app, auth, computer, key, orgId, timestamp, userId } =
      await setup();

    const cloud = serve(app);

    try {
      const passes = new NakamaCloudPasses({
        baseUrl: cloud.url,
        computerId: computer.id,
        now: timestamp,
        sign: (payload) => Promise.resolve(key.sign(payload)),
      });

      await auth.revoke({ id: computer.id, orgId, userId });

      await expect(passes.get()).rejects.toThrow();
      expect(passes.refused).toBe(true);

      passes.confirmWith("code-from-a-new-connect");
      expect(passes.refused).toBe(false);
    } finally {
      cloud.stop();
    }
  });
});

test("an unconfirmed computer can no longer be confirmed after the sign-in window", async () => {
  const { advance, auth, orgId, requestPass, timestamp, userId } =
    await setup();

  const key = testDeviceKey();

  const enrolled = await auth.enroll({
    installId: "install_late",
    name: "Laptop",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

  if (!enrolled) {
    throw new Error("enroll refused");
  }

  advance(11 * 60 * 1000);

  expect(
    (
      await requestPass(
        key.signRequest(enrolled.computer.id, {
          confirmCode: enrolled.confirmCode,
          timestamp: timestamp(),
        })
      )
    ).status
  ).toBe(401);

  // Connecting again from the same install starts a new window.
  const again = await auth.enroll({
    installId: "install_late",
    name: "Laptop",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

  expect(
    (
      await requestPass(
        key.signRequest(enrolled.computer.id, {
          confirmCode: again?.confirmCode,
          timestamp: timestamp(),
        })
      )
    ).status
  ).toBe(200);
});
