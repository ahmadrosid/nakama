import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { LLM_TOKEN_PATH } from "../http/routes/llm";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { seedOrgAdmin } from "../http/test-session-helpers";
import {
  COMPUTER_PASS_TTL_MS,
  ComputerAuthService,
  type ComputerTokenRequest,
  computerTokenPayload,
  isEd25519PublicKey,
} from "./computer-auth";

const passResponseSchema = z.object({
  expiresAt: z.number(),
  pass: z.string(),
});

function deviceKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // The raw key is the last 32 bytes of the SPKI DER encoding.
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);

  return { privateKey, publicKey: raw.toString("base64") };
}

async function setup() {
  let time = Date.parse("2026-11-03T10:00:00.000Z");
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const auth = new ComputerAuthService(databaseAdapter, () => time);
  const { app } = createMinimalHonoApp({ computerAuth: auth, databaseAdapter });

  const { orgId, userId } = await seedOrgAdmin(databaseAdapter, {
    role: "member",
  });

  const key = deviceKey();

  const computer = await auth.enroll({
    installId: "install_1",
    name: "Ada's MacBook",
    orgId,
    publicKey: key.publicKey,
    userId,
  });

  const signedRequest = (
    overrides: { nonce?: string; timestamp?: number } = {}
  ) => {
    const request = {
      computerId: computer.id,
      nonce: overrides.nonce ?? randomUUID(),
      timestamp: overrides.timestamp ?? time,
    };

    const signature = sign(
      null,
      computerTokenPayload(request, { method: "POST", path: LLM_TOKEN_PATH }),
      key.privateKey
    ).toString("base64");

    return { ...request, signature };
  };

  const requestPass = (body: ComputerTokenRequest) =>
    app.request(LLM_TOKEN_PATH, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

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

  test("signing in again from the same install reuses the computer", async () => {
    const { auth, computer, orgId, userId } = await setup();

    const again = await auth.enroll({
      installId: "install_1",
      name: "Ada's MacBook",
      orgId,
      publicKey: deviceKey().publicKey,
      userId,
    });

    expect(again.id).toBe(computer.id);
  });

  test("only a raw 32-byte Ed25519 key is a public key", () => {
    expect(isEd25519PublicKey(deviceKey().publicKey)).toBe(true);
    expect(isEd25519PublicKey(Buffer.alloc(31).toString("base64"))).toBe(false);
    expect(isEd25519PublicKey("not base64!")).toBe(false);
  });
});
