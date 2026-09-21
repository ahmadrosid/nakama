import { describe, expect, setSystemTime, test } from "bun:test";
import { TelegramManagedBotPairingService } from "./telegram-managed-bot-pairing";

function fakeTelegramFetch(getUsername: () => string) {
  let calls = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(input).split("/").at(-1);
    if (method === "getMe") {
      return Response.json({
        ok: true,
        result: { username: "NakamaManagerBot" },
      });
    }
    if (method === "getUpdates") {
      calls += 1;
      return Response.json({
        ok: true,
        result:
          calls === 1
            ? [
                {
                  managed_bot: {
                    bot: { id: 42, username: getUsername() },
                    user: { id: 77 },
                  },
                  update_id: 1,
                },
              ]
            : [],
      });
    }
    if (method === "getManagedBotToken") {
      expect(init?.body).toContain('"user_id":42');
      return Response.json({ ok: true, result: "42:secret" });
    }
    throw new Error(`unexpected Telegram method: ${method}`);
  };
}

describe("TelegramManagedBotPairingService", () => {
  test("pairs the requested managed bot and keeps it org scoped", async () => {
    let username = "";
    const service = new TelegramManagedBotPairingService(
      "manager-token",
      fakeTelegramFetch(() => username)
    );
    const started = await service.start("org-a", "user-a", "profile-a");
    username = started.suggestedUsername;

    await expect(
      service.status(started.pairingId, "org-b", "user-a")
    ).rejects.toThrow("not found");

    const ready = await service.status(started.pairingId, "org-a", "user-a");
    expect(ready).toMatchObject({
      botUsername: username,
      ownerUserId: 77,
      status: "ready",
    });

    let saved: Record<string, string> | undefined;
    await expect(
      service.apply(
        started.pairingId,
        "org-a",
        "user-a",
        "another-agent",
        async () => {}
      )
    ).rejects.toThrow();
    const applied = await service.apply(
      started.pairingId,
      "org-a",
      "user-a",
      "profile-a",
      async (input) => {
        saved = input;
      }
    );
    expect(applied.status).toBe("applied");
    expect(saved).toEqual({
      allowedUserIds: "77",
      botToken: "42:secret",
      pairedUserIds: "77",
      profileId: "profile-a",
    });
  });

  test("cancels an active pairing", async () => {
    const service = new TelegramManagedBotPairingService(
      "manager-token",
      async () =>
        Response.json({
          ok: true,
          result: { username: "ManagerBot" },
        })
    );
    const started = await service.start("org-a", "user-a", "profile-a");
    expect(
      (await service.cancel(started.pairingId, "org-a", "user-a")).status
    ).toBe("cancelled");
  });

  test("does not claim an unrelated bot when only one pairing is waiting", async () => {
    const service = new TelegramManagedBotPairingService(
      "manager-token",
      fakeTelegramFetch(() => "other_bot")
    );
    const started = await service.start("org", "user", "profile");
    expect(
      (await service.status(started.pairingId, "org", "user")).status
    ).toBe("waiting");
  });

  test("uses cloud server credentials without exposing them and retries a failed save", async () => {
    const secret = "s".repeat(43);
    const pairingId = crypto.randomUUID();
    const actions: string[] = [];
    const service = new TelegramManagedBotPairingService(
      "",
      async (input, init) => {
        expect(String(input)).toBe(
          "https://manager.example/api/telegram/pairing"
        );
        const body = JSON.parse(String(init?.body));
        actions.push(body.action);
        if (body.action === "start") {
          return Response.json({
            deepLink: `https://t.me/ManagerBot?start=${pairingId}`,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            pairingId,
            secret,
            suggestedUsername: "nakama_test_bot",
          });
        }
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${secret}`
        );
        expect(body.pairingId).toBe(pairingId);
        return Response.json(
          body.action === "cancel"
            ? { status: "cancelled" }
            : {
                botUsername: "nakama_test_bot",
                ownerUserId: 77,
                status: "ready",
                ...(body.action === "token" ? { token: "42:secret" } : {}),
              }
        );
      },
      "https://manager.example"
    );
    const started = await service.start("org", "user", "profile");
    expect(JSON.stringify(started)).not.toContain(secret);
    await expect(
      service.status(pairingId, "other-org", "user")
    ).rejects.toThrow();
    await expect(
      service.apply(pairingId, "org", "other-user", "profile", async () => {})
    ).rejects.toThrow();
    const ready = await service.status(pairingId, "org", "user");
    expect(ready.status).toBe("ready");
    expect(JSON.stringify(ready)).not.toContain(secret);
    await expect(
      service.apply(pairingId, "org", "user", "profile", async () => {
        throw new Error("save failed");
      })
    ).rejects.toThrow();
    expect(actions).not.toContain("cancel");
    const result = await service.apply(
      pairingId,
      "org",
      "user",
      "profile",
      async (saved) => {
        expect(saved).toEqual({
          allowedUserIds: "77",
          botToken: "42:secret",
          pairedUserIds: "77",
          profileId: "profile",
        });
      }
    );
    expect(result.status).toBe("applied");
    expect(actions).toEqual(["start", "status", "token", "token", "cancel"]);
    expect(JSON.stringify(result)).not.toContain("42:secret");
  });
});

describe("TelegramManagedBotPairingService deadline and save failure", () => {
  test("reports expiry past the deadline and never pairs late", async () => {
    setSystemTime(new Date("2026-09-19T10:00:00.000Z"));
    try {
      let username = "";
      const service = new TelegramManagedBotPairingService(
        "manager-token",
        fakeTelegramFetch(() => username)
      );
      const started = await service.start("org-a", "user-a", "profile-a");
      username = started.suggestedUsername;

      // One second past the 10 minute TTL, before the manager bot has reported
      // the new bot. The update is waiting in getUpdates either way.
      setSystemTime(new Date("2026-09-19T10:10:01.000Z"));

      const status = await service.status(started.pairingId, "org-a", "user-a");
      expect(status.status).toBe("expired");
      // Still null, so the expired pairing did not claim the bot that arrived.
      expect(status.botUsername).toBeNull();

      await expect(
        service.apply(started.pairingId, "org-a", "user-a", "profile-a", () =>
          Promise.resolve()
        )
      ).rejects.toThrow("expired");
    } finally {
      setSystemTime();
    }
  });

  test("leaves the pairing unapplied when the connection fails to save", async () => {
    let username = "";
    const service = new TelegramManagedBotPairingService(
      "manager-token",
      fakeTelegramFetch(() => username)
    );
    const started = await service.start("org-a", "user-a", "profile-a");
    username = started.suggestedUsername;
    await service.status(started.pairingId, "org-a", "user-a");

    await expect(
      service.apply(started.pairingId, "org-a", "user-a", "profile-a", () =>
        Promise.reject(new Error("telegram worker failed to start"))
      )
    ).rejects.toThrow("telegram worker failed to start");

    // Never reported as connected, and the failed profile was not recorded, so
    // the admin can retry rather than seeing a bot that does not run.
    const after = await service.status(started.pairingId, "org-a", "user-a");
    expect(after.status).toBe("ready");
    expect(after.profileId).toBe("profile-a");
  });
});
