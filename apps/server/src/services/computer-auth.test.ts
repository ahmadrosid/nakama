import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { seedOrgAdmin } from "../http/test-session-helpers";
import { testDeviceKey } from "../testing/computer-device";
import {
  COMPUTER_PASS_TTL_MS,
  ComputerAuthService,
  type ComputerTokenRequest,
  isEd25519PublicKey,
  LLM_TOKEN_PATH,
} from "./computer-auth";

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

  const { computer, confirmCode } = await auth.enroll({
    installId: "install_1",
    name: "Ada's MacBook",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

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
    auth,
    computer,
    databaseAdapter,
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

  test("a revoked computer and a removed member lose access, also with a pass they hold", async () => {
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
    expect(await auth.verifyPass(pass)).not.toBeNull();

    expect(await auth.revoke({ id: computer.id, orgId, userId })).toBe(true);
    expect(await auth.verifyPass(pass)).toBeNull();
    expect((await requestPass(signedRequest())).status).toBe(401);

    const actions = (await databaseAdapter.listAuditEvents({ orgId })).map(
      (event) => event.action
    );

    expect(actions).toContain("computer.enroll");
    expect(actions).toContain("computer.revoke");
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

    const { computer, confirmCode } = await auth.enroll({
      installId: "install_attacker",
      name: "Work laptop",
      orgId,
      publicKey: attacker.publicKey,
      userId,
    });

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

  test("signing in again from the same install reuses the computer", async () => {
    const { auth, computer, orgId, userId } = await setup();

    const { computer: again } = await auth.enroll({
      installId: "install_1",
      name: "Ada's MacBook",
      orgId,
      publicKey: testDeviceKey().publicKey,
      userId,
    });

    expect(again.id).toBe(computer.id);
  });

  test("only a raw 32-byte Ed25519 key is a public key", () => {
    expect(isEd25519PublicKey(testDeviceKey().publicKey)).toBe(true);
    expect(isEd25519PublicKey(Buffer.alloc(31).toString("base64"))).toBe(false);
    expect(isEd25519PublicKey("not base64!")).toBe(false);
  });
});
