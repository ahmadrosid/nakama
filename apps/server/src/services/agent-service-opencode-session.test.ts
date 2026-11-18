import { describe, expect, spyOn, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { asTestFetch } from "../providers/test-helpers";
import { setupTestConfigDir } from "../test-config-dir";
import { AgentService } from "./agent-service";
import { createDefaultProfile } from "./agent-service-test-fixtures";

const ORG_ID = "org_test";

interface AgentServiceTitleAccess {
  sessionTitleService: {
    generateSessionTitle(id: string): Promise<void>;
  };
}

function privateServiceAccess<T>(service: AgentService): T {
  // SAFETY: Tests use named interfaces for private service members.
  return Object.create(service) as T;
}

describe("AgentService OpenCode Go session routing", () => {
  setupTestConfigDir("nakama-opencode-session-");

  test("sends the chat session id to the provider as x-opencode-session", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      model: "oc::opencode-go/kimi-k2.7-code",
    };

    await db.upsertProfile(profile);

    const seenSessions: string[] = [];
    const seenUrls: string[] = [];

    using fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      asTestFetch((input, init?) => {
        const request = new Request(input, init);

        seenUrls.push(request.url);
        seenSessions.push(request.headers.get("x-opencode-session") ?? "");

        return Promise.resolve(
          Response.json({
            choices: [{ message: { content: "ok", role: "assistant" } }],
          })
        );
      })
    );

    const service = new AgentService(
      {
        defaultProviderId: "oc",
        providers: [
          {
            apiKey: "test-key",
            createdAt: profile.createdAt,
            id: "oc",
            label: "OpenCode Go",
            type: "opencode_go",
          },
        ],
      },
      null,
      db
    );

    const sessionId = await service.createSession(ORG_ID, "web", profile.id);
    const session = await service.sessions.get(sessionId, ORG_ID);

    await session!.send({ message: "hello" });

    expect(fetchMock).toHaveBeenCalled();
    expect(
      seenUrls.some((url) => url.startsWith("https://opencode.ai/zen/go/"))
    ).toBe(true);
    // Every call in the turn carries the chat's own ID, not a fresh random one
    // per harness build (title generation included).
    expect(seenSessions.length).toBeGreaterThan(0);
    expect([...new Set(seenSessions)]).toEqual([`ses_${sessionId}`]);
  });

  test("title generation carries the chat session id", async () => {
    const db = createInMemoryDatabaseAdapter();

    const profile = {
      ...createDefaultProfile(),
      model: "oc::opencode-go/kimi-k2.7-code",
    };

    await db.upsertProfile(profile);

    const seenSessions: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = asTestFetch((input, init?) => {
      const request = new Request(input, init);
      seenSessions.push(request.headers.get("x-opencode-session") ?? "");

      return Promise.resolve(
        Response.json({
          choices: [{ message: { content: "ok", role: "assistant" } }],
        })
      );
    });

    try {
      const service = new AgentService(
        {
          defaultProviderId: "oc",
          providers: [
            {
              apiKey: "test-key",
              createdAt: profile.createdAt,
              id: "oc",
              label: "OpenCode Go",
              type: "opencode_go",
            },
          ],
        },
        null,
        db
      );

      const sessionId = await service.createSession(ORG_ID, "web", profile.id);
      const createdAt = new Date().toISOString();

      await db.replaceMessagesForSession(sessionId, [
        {
          createdAt,
          id: "msg_title_user",
          payload: { content: "hello", role: "user" },
          seq: 0,
          sessionId,
        },
        {
          createdAt,
          id: "msg_title_assistant",
          payload: { content: "hi there", role: "assistant" },
          seq: 1,
          sessionId,
        },
      ]);

      const titleService =
        privateServiceAccess<AgentServiceTitleAccess>(
          service
        ).sessionTitleService;

      await titleService.generateSessionTitle(sessionId);

      expect(seenSessions.length).toBeGreaterThan(0);
      expect(
        seenSessions.every((session) => session === `ses_${sessionId}`)
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
