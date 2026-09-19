import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import postgres from "postgres";
import { handleTelegramPairing, handleTelegramWebhook } from "./index";

// Use a disposable database with schema.sql applied; this suite clears telegram_pairings.
describe.skipIf(!process.env.TEST_TELEGRAM_DATABASE_URL)(
  "shared Telegram manager",
  () => {
    const sql = postgres(
      process.env.TEST_TELEGRAM_DATABASE_URL ?? "postgresql://localhost/unused"
    );
    const calls: string[] = [];
    let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
    const options = {
      managerToken: "manager:secret",
      sql,
      webhookSecret: "webhook-secret",
    };

    beforeEach(async () => {
      await sql`DELETE FROM telegram_pairings`;
      calls.length = 0;
      fetchMock = spyOn(globalThis, "fetch").mockImplementation(
        async (input, init) => {
          const url = String(input);
          const method = url.split("/").at(-1)!;
          calls.push(method);
          if (method === "getMe") {
            return Response.json({
              ok: true,
              result: { can_manage_bots: true, username: "ManagerBot" },
            });
          }
          if (method === "sendMessage") {
            return Response.json({ ok: true, result: { message_id: 1 } });
          }
          expect(method).toBe("getManagedBotToken");
          expect(JSON.parse(String(init?.body))).toEqual({ user_id: 42 });
          return Response.json({ ok: true, result: "42:bot-secret" });
        }
      );
    });
    afterEach(() => {
      fetchMock.mockRestore();
    });
    afterAll(async () => {
      await sql`DELETE FROM telegram_pairings`;
      await sql.end();
    });

    function api(action: string, pairingId?: string, secret?: string) {
      return handleTelegramPairing(
        new Request("https://cloud.test/api/telegram/pairing", {
          body: JSON.stringify({ action, pairingId }),
          headers: secret ? { Authorization: `Bearer ${secret}` } : {},
          method: "POST",
        }),
        options
      );
    }
    function webhook(update: unknown, secret = "webhook-secret") {
      return handleTelegramWebhook(
        new Request("https://cloud.test/api/telegram/webhook", {
          body: JSON.stringify(update),
          headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
          method: "POST",
        }),
        options
      );
    }
    function startMessage(id: string, userId = 77) {
      return {
        message: {
          chat: { id: userId, type: "private" },
          from: { id: userId, is_bot: false },
          text: `/start ${id}`,
        },
      };
    }
    function managed(username: string, userId = 77) {
      return {
        managed_bot: { bot: { id: 42, username }, user: { id: userId } },
      };
    }

    it("hands the token only to the initiating server after both user and bot match", async () => {
      const response = await api("start");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const pairing = await response.json();
      expect(pairing.deepLink).not.toContain(pairing.secret);
      expect((await api("status", pairing.pairingId)).status).toBe(401);
      expect(
        (await api("token", pairing.pairingId, "x".repeat(43))).status
      ).toBe(404);
      expect(
        (await api("token", pairing.pairingId, pairing.secret)).status
      ).toBe(409);
      expect(
        (await webhook(startMessage(pairing.pairingId), "wrong-secret")).status
      ).toBe(401);
      await webhook(managed(pairing.suggestedUsername));
      expect(
        (await (await api("status", pairing.pairingId, pairing.secret)).json())
          .status
      ).toBe("waiting");
      await webhook(startMessage(pairing.pairingId));
      await webhook(startMessage(pairing.pairingId, 88));
      await webhook(managed(pairing.suggestedUsername, 88));
      await webhook(managed("unrelated_bot"));
      expect(
        (await (await api("status", pairing.pairingId, pairing.secret)).json())
          .status
      ).toBe("waiting");
      await webhook(managed(pairing.suggestedUsername));
      const status = await (
        await api("status", pairing.pairingId, pairing.secret)
      ).json();
      expect(status).toEqual({
        botUsername: pairing.suggestedUsername,
        ownerUserId: 77,
        status: "ready",
      });
      expect(calls).not.toContain("getManagedBotToken");
      expect(
        await (await api("token", pairing.pairingId, pairing.secret)).json()
      ).toMatchObject({ ownerUserId: 77, token: "42:bot-secret" });
      // Retries are allowed until the client acknowledges its successful local save.
      expect(
        (await api("token", pairing.pairingId, pairing.secret)).status
      ).toBe(200);
      const rows = await sql`SELECT * FROM telegram_pairings`;
      expect(JSON.stringify(rows)).not.toContain(pairing.secret);
      expect(JSON.stringify(rows)).not.toContain("42:bot-secret");
      await api("cancel", pairing.pairingId, pairing.secret);
      expect(
        (await api("token", pairing.pairingId, pairing.secret)).status
      ).toBe(404);
    });

    it("rejects expired and transferred bots, including ready pairings", async () => {
      const first = await (await api("start")).json();
      await webhook(startMessage(first.pairingId));
      await webhook(managed(first.suggestedUsername));
      await sql`UPDATE telegram_pairings SET expires_at = now() - interval '1 second' WHERE id = ${first.pairingId}`;
      expect((await api("token", first.pairingId, first.secret)).status).toBe(
        404
      );
      const second = await (await api("start")).json();
      await webhook(startMessage(second.pairingId));
      await webhook(managed(second.suggestedUsername));
      await webhook(managed(second.suggestedUsername, 88));
      expect((await api("token", second.pairingId, second.secret)).status).toBe(
        404
      );
      expect(calls).not.toContain("getManagedBotToken");
    });

    it("keeps concurrent pairings separate and rejects malformed requests", async () => {
      const first = await (await api("start")).json();
      const second = await (await api("start")).json();
      await webhook(startMessage(first.pairingId));
      await webhook(startMessage(second.pairingId, 88));
      await webhook(managed(second.suggestedUsername, 77));
      expect(
        (await (await api("status", first.pairingId, first.secret)).json())
          .status
      ).toBe("waiting");
      expect(
        (await (await api("status", second.pairingId, second.secret)).json())
          .status
      ).toBe("waiting");
      expect((await api("status", second.pairingId, first.secret)).status).toBe(
        404
      );
      expect((await api("token", "invalid", first.secret)).status).toBe(400);
      expect(
        (await webhook({ managed_bot: { bot: { id: -1 }, user: { id: 77 } } }))
          .status
      ).toBe(400);
    });

    it("does not leak credentials on upstream failure and can retry", async () => {
      const pairing = await (await api("start")).json();
      await webhook(startMessage(pairing.pairingId));
      await webhook(managed(pairing.suggestedUsername));
      fetchMock.mockRejectedValueOnce(
        new Error(
          "https://api.telegram.org/botmanager:secret/getManagedBotToken"
        )
      );
      const failed = await api("token", pairing.pairingId, pairing.secret);
      expect(failed.status).toBe(502);
      expect(await failed.text()).not.toContain("manager:secret");
      expect(
        (await api("token", pairing.pairingId, pairing.secret)).status
      ).toBe(200);
    });

    it("caps active pairings and reclaims expired capacity", async () => {
      await sql`
      INSERT INTO telegram_pairings (id, secret_hash, suggested_username, expires_at)
      SELECT gen_random_uuid(), 'test', 'test_' || n || '_bot', now() + interval '10 minutes'
      FROM generate_series(1, 1000) n
    `;
      expect((await api("start")).status).toBe(429);
      expect(calls).toHaveLength(0);
      await sql`UPDATE telegram_pairings SET expires_at = now() - interval '1 second' WHERE suggested_username = 'test_1_bot'`;
      expect((await api("start")).status).toBe(200);
      const [{ count }] =
        await sql`SELECT count(*)::int AS count FROM telegram_pairings`;
      expect(count).toBe(1000);
    });
  }
);
