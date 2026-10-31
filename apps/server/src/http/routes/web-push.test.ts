import { describe, expect, spyOn, test } from "bun:test";
import type { ProfileResponse, SessionSummary } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { AgentService } from "../../services/agent-service";
import { webPushService } from "../../services/web-push-service";
import { setupTestConfigDir } from "../../test-config-dir";
import { TURN_CANCELLED_ERROR } from "../shared";
import { createMinimalHonoApp } from "../test-app-helpers";
import { loginUserSession, seedOrgAdmin } from "../test-session-helpers";
import { pushTurnEnded } from "./web-push";

setupTestConfigDir("nakama-web-push-routes-test-");

const ORG = "org_push";

interface SubscriptionBody {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}

async function createScenario() {
  const databaseAdapter = createInMemoryDatabaseAdapter();
  const agent = new AgentService(null, null, databaseAdapter);
  const { app } = createMinimalHonoApp({ agent, databaseAdapter });

  const { email, password } = await seedOrgAdmin(databaseAdapter, {
    orgId: ORG,
    profileId: "profile_push",
    userId: "user_push",
  });

  const session = await loginUserSession(app, email, password, ORG);

  const headers = session.headers({
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrfToken,
  });

  const call = (method: string, path: string, body?: SubscriptionBody) =>
    app.fetch(
      new Request(`http://localhost:4310${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        method,
      })
    );

  return { call };
}

describe("push routes", () => {
  test("hands out one public key and stores a browser push subscription", async () => {
    const { call } = await createScenario();

    const first = await (await call("GET", "/v1/push/public-key")).json();
    const second = await (await call("GET", "/v1/push/public-key")).json();

    expect(first.publicKey).toMatch(/^B[\w-]{86}$/);
    expect(second.publicKey).toBe(first.publicKey);

    const saved = await call("PUT", "/v1/push/subscription", {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { auth: "AAAAAAAAAAAAAAAAAAAAAA", p256dh: "BAAA" },
    });

    expect(saved.status).toBe(204);
  });

  test("refuses an endpoint that is not a browser push service", async () => {
    const { call } = await createScenario();

    const response = await call("PUT", "/v1/push/subscription", {
      endpoint: "https://127.0.0.1:4310/v1/sessions",
      keys: { auth: "AAAAAAAAAAAAAAAAAAAAAA", p256dh: "BAAA" },
    });

    expect(response.status).toBe(400);
  });
});

describe("pushTurnEnded", () => {
  // SAFETY: pushTurnEnded reads only profileId and title off the summary.
  const summary = {
    profileId: "profile_push",
    title: "Launch plan",
  } as SessionSummary;

  function agentWith(found: SessionSummary | null) {
    return {
      // SAFETY: pushTurnEnded reads only the profile's name.
      getProfile: async () =>
        ({ profile: { name: "Writer" } }) as ProfileResponse,
      getSessionSummary: async () => found,
    };
  }

  const target = { orgId: ORG, sessionId: "s1", userId: "user_push" };

  test("pushes the agent, chat title and start of the reply", async () => {
    const notify = spyOn(webPushService, "notify").mockResolvedValue();

    try {
      await pushTurnEnded(agentWith(summary), target, {
        reply: "Here is\n\nthe plan.",
        type: "done",
      });

      expect(notify).toHaveBeenCalledWith("user_push", {
        body: "Here is the plan.",
        tag: "session-s1",
        title: "Writer · Launch plan",
        url: "/chat/profile_push/s1?org=org_push",
      });
    } finally {
      notify.mockRestore();
    }
  });

  test("keeps a long title inside the push size limit", async () => {
    const notify = spyOn(webPushService, "notify").mockResolvedValue();

    try {
      await pushTurnEnded(
        agentWith({ ...summary, title: "🚀".repeat(2000) }),
        target,
        { reply: "ok", type: "done" }
      );

      const message = notify.mock.calls[0]?.[1];
      expect(Array.from(message?.title ?? "")).toHaveLength(100);
      expect(
        new TextEncoder().encode(JSON.stringify(message)).length
      ).toBeLessThan(4000);
    } finally {
      notify.mockRestore();
    }
  });

  test("sends nothing for a stopped turn or a cognito chat", async () => {
    const notify = spyOn(webPushService, "notify").mockResolvedValue();

    try {
      await pushTurnEnded(agentWith(summary), target, {
        error: TURN_CANCELLED_ERROR,
        type: "error",
      });
      await pushTurnEnded(agentWith(null), target, {
        reply: "secret",
        type: "done",
      });

      expect(notify).not.toHaveBeenCalled();
    } finally {
      notify.mockRestore();
    }
  });

  test("tells the user when the reply failed", async () => {
    const notify = spyOn(webPushService, "notify").mockResolvedValue();

    try {
      await pushTurnEnded(agentWith(summary), target, {
        error: "Provider timed out",
        type: "error",
      });

      expect(notify.mock.calls[0]?.[1].body).toBe(
        "The reply failed: Provider timed out"
      );
    } finally {
      notify.mockRestore();
    }
  });
});
