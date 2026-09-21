import { createHash, randomBytes, randomUUID, timingSafeEqual, } from "node:crypto";
import { z } from "zod";
import { bindTelegramPairing, completeTelegramPairing, createTelegramPairing, deleteTelegramPairing, getTelegramPairing, } from "./store.js";
const actionSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("start") }),
    z.object({
        action: z.enum(["status", "token", "cancel"]),
        pairingId: z.uuid(),
    }),
]);
const telegramId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const updateSchema = z.object({
    managed_bot: z
        .object({
        bot: z.object({
            id: telegramId,
            username: z.string().regex(/^[a-zA-Z0-9_]{5,32}$/),
        }),
        user: z.object({ id: telegramId }),
    })
        .optional(),
    message: z
        .object({
        chat: z.object({ id: z.number().int().safe(), type: z.string() }),
        from: z.object({ id: telegramId, is_bot: z.boolean() }).optional(),
        text: z.string().optional(),
    })
        .optional(),
});
function digest(value) {
    return createHash("sha256").update(value).digest("hex");
}
function json(body, status = 200) {
    return Response.json(body, {
        headers: { "Cache-Control": "no-store" },
        status,
    });
}
async function telegram(token, method, body) {
    if (!token) {
        throw new Error("Telegram manager is not configured");
    }
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(5000),
    });
    const payload = (await response.json());
    if (!(response.ok && payload.ok) || payload.result === undefined) {
        throw new Error("Telegram request failed");
    }
    return payload.result;
}
export async function handleTelegramPairing(request, options) {
    if (!(options.managerToken && options.webhookSecret)) {
        return json({ error: "Telegram manager is not configured" }, 503);
    }
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return json({ error: "Invalid pairing request" }, 400);
    }
    const action = parsed.data;
    try {
        if (action.action === "start") {
            const id = randomUUID();
            const secret = randomBytes(32).toString("base64url");
            const suggestedUsername = `nakama_${id.replaceAll("-", "").slice(0, 16)}_bot`;
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            if (!(await createTelegramPairing(options.sql, {
                expiresAt,
                id,
                secretHash: digest(secret),
                suggestedUsername,
            }))) {
                return json({ error: "Too many pairings. Try again later." }, 429);
            }
            try {
                const manager = await telegram(options.managerToken, "getMe", {});
                if (!(manager.username && manager.can_manage_bots)) {
                    throw new Error("Manager permission missing");
                }
                const deepLink = `https://t.me/${manager.username}?start=${id}`;
                return json({
                    deepLink,
                    expiresAt,
                    pairingId: id,
                    qrPayload: deepLink,
                    secret,
                    suggestedUsername,
                });
            }
            catch (error) {
                await deleteTelegramPairing(options.sql, id, digest(secret));
                throw error;
            }
        }
        const secret = request.headers
            .get("Authorization")
            ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        if (!secret) {
            return json({ error: "Unauthorized" }, 401);
        }
        const secretHash = digest(secret);
        const pairing = await getTelegramPairing(options.sql, action.pairingId, secretHash);
        if (!pairing) {
            return json({ error: "Pairing not found or expired" }, 404);
        }
        if (action.action === "cancel") {
            await deleteTelegramPairing(options.sql, pairing.id, secretHash);
            return json({ status: "cancelled" });
        }
        const status = {
            botUsername: pairing.bot_username,
            ownerUserId: pairing.owner_user_id ? Number(pairing.owner_user_id) : null,
            status: pairing.bot_id ? "ready" : "waiting",
        };
        if (action.action === "status") {
            return json(status);
        }
        if (!(pairing.bot_id && pairing.owner_user_id)) {
            return json({ error: "Bot is not ready" }, 409);
        }
        const token = await telegram(options.managerToken, "getManagedBotToken", { user_id: Number(pairing.bot_id) });
        // Recheck after the external call: cancellation/ownership changes may race it.
        const current = await getTelegramPairing(options.sql, pairing.id, secretHash);
        if (!current || current.bot_id !== pairing.bot_id) {
            return json({ error: "Pairing expired" }, 404);
        }
        return json({ ...status, token });
    }
    catch {
        // Never include upstream URLs/errors: Telegram URLs contain the manager token.
        return json({ error: "Telegram connection unavailable. Please retry." }, 502);
    }
}
export async function handleTelegramWebhook(request, options) {
    const expected = options.webhookSecret;
    const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!(expected &&
        timingSafeEqual(Buffer.from(digest(expected)), Buffer.from(digest(actual))))) {
        return json({ error: "Unauthorized" }, 401);
    }
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return json({ error: "Invalid update" }, 400);
    }
    try {
        const { message, managed_bot: managed } = parsed.data;
        const id = message?.text?.match(/^\/start(?:@\w+)? ([0-9a-f-]{36})$/)?.[1];
        if (id &&
            z.uuid().safeParse(id).success &&
            message?.chat.type === "private" &&
            message.from &&
            !message.from.is_bot &&
            message.from.id === message.chat.id) {
            const pairing = await bindTelegramPairing(options.sql, id, String(message.from.id));
            if (pairing) {
                const manager = await telegram(options.managerToken, "getMe", {});
                await telegram(options.managerToken, "sendMessage", {
                    chat_id: message.chat.id,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "Create Telegram bot",
                                    url: `https://t.me/newbot/${manager.username}/${pairing.suggested_username}?name=Nakama`,
                                },
                            ],
                        ],
                    },
                    text: "Create your bot to connect it to the Nakama server where you scanned this QR. Keep the suggested username so we can match it securely.",
                });
            }
        }
        if (managed) {
            await completeTelegramPairing(options.sql, {
                id: String(managed.bot.id),
                ownerUserId: String(managed.user.id),
                username: managed.bot.username,
            });
        }
        return json({ ok: true });
    }
    catch {
        // Telegram retries failed deliveries; database mutations are idempotent.
        return json({ error: "Please retry" }, 503);
    }
}
