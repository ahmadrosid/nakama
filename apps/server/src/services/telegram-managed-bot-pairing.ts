import { randomUUID } from "node:crypto";
import type {
  TelegramPairingStartResponse,
  TelegramPairingStatusResponse,
} from "@nakama/core";
import { z } from "zod";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const API_BASE = "https://api.telegram.org";
const cloudStartSchema = z.object({
  deepLink: z.url().refine((value) => new URL(value).origin === "https://t.me"),
  expiresAt: z.iso.datetime(),
  pairingId: z.uuid(),
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  suggestedUsername: z.string(),
});
const cloudStatusSchema = z.object({
  botUsername: z.string().nullable(),
  ownerUserId: z.number().int().positive().nullable(),
  status: z.enum(["waiting", "ready"]),
});

type PairingState = "waiting" | "ready" | "cancelled" | "applied";

type Pairing = {
  cloudSecret?: string;
  botId?: number;
  botUsername?: string;
  expiresAt: string;
  id: string;
  orgId: string;
  ownerUserId?: number;
  profileId: string;
  state: PairingState;
  suggestedUsername: string;
  userId: string;
  token?: string;
};

export class TelegramManagedBotPairingService {
  private readonly pairings = new Map<string, Pairing>();
  private offset = 0;
  private readonly pollTimer = setInterval(() => {
    if (
      [...this.pairings.values()].some(
        (pairing) => !pairing.cloudSecret && pairing.state === "waiting"
      )
    ) {
      void this.sync().catch(() => undefined);
    }
  }, 2000);
  private syncPromise: Promise<void> | null = null;

  constructor(
    private readonly managerToken = process.env
      .NAKAMA_TELEGRAM_MANAGER_BOT_TOKEN,
    private readonly request: (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response> = fetch,
    private readonly cloudUrl = process.env.NAKAMA_TELEGRAM_MANAGER_URL ??
      "https://getnakama.cloud"
  ) {
    this.pollTimer.unref?.();
  }

  async start(
    orgId: string,
    userId: string,
    profileId: string
  ): Promise<TelegramPairingStartResponse> {
    for (const [id, pairing] of this.pairings) {
      if (Date.now() >= Date.parse(pairing.expiresAt)) {
        this.pairings.delete(id);
      }
    }
    if (!this.managerToken) {
      const started = cloudStartSchema.parse(await this.cloudCall("start"));
      this.pairings.set(started.pairingId, {
        cloudSecret: started.secret,
        expiresAt: started.expiresAt,
        id: started.pairingId,
        orgId,
        profileId,
        state: "waiting",
        suggestedUsername: started.suggestedUsername,
        userId,
      });
      return {
        deepLink: started.deepLink,
        expiresAt: started.expiresAt,
        pairingId: started.pairingId,
        qrPayload: started.deepLink,
        suggestedUsername: started.suggestedUsername,
      };
    }
    const manager = await this.call<{ username?: string }>("getMe");
    if (!manager.username) {
      throw new Error("Telegram manager bot is not configured.");
    }

    const id = randomUUID();
    const suggestedUsername = `nakama_${id.replaceAll("-", "").slice(0, 16)}_bot`;
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    const deepLink = `https://t.me/newbot/${manager.username}/${suggestedUsername}?name=Nakama`;
    this.pairings.set(id, {
      expiresAt,
      id,
      orgId,
      profileId,
      state: "waiting",
      suggestedUsername,
      userId,
    });

    return {
      deepLink,
      expiresAt,
      pairingId: id,
      qrPayload: deepLink,
      suggestedUsername,
    };
  }

  async status(
    pairingId: string,
    orgId: string,
    userId: string,
    profileId?: string
  ): Promise<TelegramPairingStatusResponse> {
    const pairing = this.authorize(pairingId, orgId, userId, profileId);
    if (
      (pairing.state === "waiting" || pairing.state === "ready") &&
      Date.now() >= Date.parse(pairing.expiresAt)
    ) {
      pairing.state = "cancelled";
    }
    if (pairing.state === "waiting") {
      if (pairing.cloudSecret) {
        const status = cloudStatusSchema.parse(
          await this.cloudCall("status", pairing)
        );
        if (pairing.state === "waiting") {
          pairing.state = status.status;
          pairing.botUsername = status.botUsername ?? undefined;
          pairing.ownerUserId = status.ownerUserId ?? undefined;
        }
      } else {
        await this.sync();
      }
    }
    return this.toResponse(pairing);
  }

  async cancel(
    pairingId: string,
    orgId: string,
    userId: string,
    profileId?: string
  ): Promise<TelegramPairingStatusResponse> {
    const pairing = this.authorize(pairingId, orgId, userId, profileId);
    if (pairing.state === "waiting" || pairing.state === "ready") {
      if (pairing.cloudSecret) {
        await this.cloudCall("cancel", pairing);
      }
      pairing.state = "cancelled";
      pairing.token = undefined;
    }
    return this.toResponse(pairing);
  }

  async apply(
    pairingId: string,
    orgId: string,
    userId: string,
    profileId: string,
    save: (input: {
      allowedUserIds: string;
      botToken: string;
      pairedUserIds: string;
      profileId: string;
    }) => Promise<void>
  ): Promise<TelegramPairingStatusResponse> {
    const pairing = this.authorize(pairingId, orgId, userId, profileId);
    if (Date.now() >= Date.parse(pairing.expiresAt)) {
      throw new Error("Telegram pairing expired. Start a new pairing.");
    }
    if (pairing.state === "ready" && pairing.cloudSecret) {
      const result = cloudStatusSchema
        .extend({ token: z.string().min(1) })
        .parse(await this.cloudCall("token", pairing));
      pairing.token = result.token;
      pairing.ownerUserId = result.ownerUserId ?? undefined;
    }
    if (
      pairing.state !== "ready" ||
      !pairing.token ||
      pairing.ownerUserId == null
    ) {
      throw new Error("Telegram bot is not ready to connect.");
    }
    await save({
      allowedUserIds: String(pairing.ownerUserId),
      botToken: pairing.token,
      pairedUserIds: String(pairing.ownerUserId),
      profileId,
    });
    pairing.state = "applied";
    pairing.token = undefined;
    if (pairing.cloudSecret) {
      // Saving succeeded; a failed cleanup must not undo the local connection.
      await this.cloudCall("cancel", pairing).catch(() => undefined);
      pairing.cloudSecret = undefined;
    }
    return this.toResponse(pairing);
  }

  private authorize(
    pairingId: string,
    orgId: string,
    userId: string,
    profileId?: string
  ): Pairing {
    const pairing = this.pairings.get(pairingId);
    if (
      !pairing ||
      pairing.orgId !== orgId ||
      pairing.userId !== userId ||
      (profileId !== undefined && pairing.profileId !== profileId)
    ) {
      throw new Error("Telegram pairing was not found.");
    }
    return pairing;
  }

  private toResponse(pairing: Pairing): TelegramPairingStatusResponse {
    return {
      botUsername: pairing.botUsername ?? null,
      expiresAt: pairing.expiresAt,
      ownerUserId: pairing.ownerUserId ?? null,
      pairingId: pairing.id,
      profileId: pairing.profileId,
      status:
        pairing.state === "cancelled" &&
        Date.now() >= Date.parse(pairing.expiresAt)
          ? "expired"
          : pairing.state,
    };
  }

  // This make sure pullUpdates run multiple times at once
  private async sync(): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }
    this.syncPromise = this.pullUpdates().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async pullUpdates(): Promise<void> {
    const updates = await this.call<
      Array<{
        managed_bot?: {
          bot?: { id?: number; username?: string };
          user?: { id?: number };
        };
        update_id?: number;
      }>
    >("getUpdates", {
      allowed_updates: ["managed_bot"],
      limit: 100,
      ...(this.offset ? { offset: this.offset } : {}),
      timeout: 0,
    });
    for (const update of updates) {
      if (typeof update.update_id === "number") {
        this.offset = Math.max(this.offset, update.update_id + 1);
      }
      const managed = update.managed_bot;
      const bot = managed?.bot;
      const ownerUserId = managed?.user?.id;
      if (!bot?.id || ownerUserId == null) {
        continue;
      }
      const waiting = [...this.pairings.values()].filter(
        (pairing) => pairing.state === "waiting"
      );
      const pairing = waiting.find(
        (candidate) => candidate.suggestedUsername === bot.username
      );
      if (!pairing || Date.now() >= Date.parse(pairing.expiresAt)) {
        continue;
      }
      pairing.botId = bot.id;
      pairing.botUsername = bot.username;
      pairing.ownerUserId = ownerUserId;
      pairing.token = await this.call<string>("getManagedBotToken", {
        user_id: bot.id,
      });
      pairing.state = "ready";
    }
  }

  private async cloudCall(action: string, pairing?: Pairing): Promise<unknown> {
    const url = new URL("/api/telegram/pairing", this.cloudUrl);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    ) {
      throw new Error("Telegram manager URL must use HTTPS.");
    }
    const response = await this.request(url, {
      body: JSON.stringify({
        action,
        ...(pairing ? { pairingId: pairing.id } : {}),
      }),
      headers: {
        "content-type": "application/json",
        ...(pairing?.cloudSecret
          ? { authorization: `Bearer ${pairing.cloudSecret}` }
          : {}),
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404 && pairing) {
      pairing.state = "cancelled";
      pairing.token = undefined;
    }
    if (!response.ok) {
      throw new Error(
        "Telegram cloud connection failed. Please retry or start a new pairing."
      );
    }
    return response.json();
  }

  private async call<T>(
    method: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    if (!this.managerToken) {
      throw new Error(
        "Telegram manager bot is not configured, please include NAKAMA_TELEGRAM_MANAGER_BOT_TOKEN in environment variable."
      );
    }
    const response = await this.request(
      `${API_BASE}/bot${encodeURIComponent(this.managerToken)}/${method}`,
      {
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { "content-type": "application/json" } : undefined,
        method: body ? "POST" : "GET",
        signal: AbortSignal.timeout(5000),
      }
    );
    const payload = (await response.json()) as {
      description?: string;
      ok?: boolean;
      result?: T;
    };
    if (!(response.ok && payload.ok && payload.result !== undefined)) {
      throw new Error(
        payload.description ?? "Telegram manager bot request failed."
      );
    }
    return payload.result;
  }
}

export const telegramManagedBotPairing = new TelegramManagedBotPairingService();
