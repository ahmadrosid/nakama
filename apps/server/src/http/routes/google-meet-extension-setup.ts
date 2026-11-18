import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AuthService } from "../../services/auth-service";
import { GoogleMeetService } from "../../services/google-meet/service";
import { createMinimalHonoApp } from "../test-app-helpers";
import {
  loginUserSession,
  setupFreshInstallSession,
  type TestBrowserSession,
} from "../test-session-helpers";

export const base = "http://localhost:4310";

/** Each test file drains this in its own afterEach. */
export const cleanups: Array<() => Promise<void>> = [];

const pairSchema = z.object({
  code: z.string(),
  expiresIn: z.number(),
  pairId: z.string(),
});

export async function setup(openaiKey: () => string | null = () => null) {
  const root = await mkdtemp(join(tmpdir(), "meet-extension-"));
  const authService = new AuthService();
  const { databaseAdapter } = createMinimalHonoApp();

  const googleMeetService = new GoogleMeetService(
    databaseAdapter,
    root,
    async () => ({ text: "Speech" }),
    openaiKey
  );

  const { app } = createMinimalHonoApp({
    authService,
    databaseAdapter,
    googleMeetService,
  });

  cleanups.push(async () => {
    await googleMeetService.close();
    await rm(root, { force: true, recursive: true });
  });

  const admin = await setupFreshInstallSession(app, databaseAdapter);

  const action = (
    session: TestBrowserSession,
    name: string,
    input: Record<string, string | boolean> = {}
  ) =>
    app.fetch(
      new Request(`${base}/v1/meet/actions/${name}`, {
        body: JSON.stringify(input),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

  const startPairing = async () => {
    const response = await app.fetch(
      new Request(`${base}/v1/meet/extension/pair`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);

    return pairSchema.parse(await response.json());
  };

  const poll = (pairId: string) =>
    app.fetch(new Request(`${base}/v1/meet/extension/pair/${pairId}`));

  const pair = async (session: TestBrowserSession = admin) => {
    const { code, pairId } = await startPairing();
    expect((await action(session, "approve-extension", { code })).status).toBe(
      200
    );
    const response = await poll(pairId);
    expect(response.status).toBe(200);

    return z
      .object({ key: z.string(), status: z.literal("approved") })
      .parse(await response.json()).key;
  };

  const status = (key: string, headers: Record<string, string> = {}) =>
    app.fetch(
      new Request(`${base}/v1/meet/extension/status`, {
        headers: { Authorization: `Bearer ${key}`, ...headers },
      })
    );

  const addMember = async (email: string) => {
    const now = new Date().toISOString();
    const userId = `user_${email.split("@")[0]}`;
    await databaseAdapter.createUser({
      createdAt: now,
      email,
      id: userId,
      passwordHash: await authService.hashPassword("password123"),
      updatedAt: now,
    });
    await databaseAdapter.upsertOrgMember({
      createdAt: now,
      orgId: admin.orgId,
      role: "member",
      userId,
    });

    return {
      session: await loginUserSession(app, email, "password123", admin.orgId),
      userId,
    };
  };

  return {
    action,
    addMember,
    admin,
    app,
    databaseAdapter,
    googleMeetService,
    pair,
    poll,
    root,
    startPairing,
    status,
  };
}
