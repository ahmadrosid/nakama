import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getUserConfigDir, resolveWebPublicUrl } from "@nakama/core";
import {
  generateVapidKeys,
  sendWebPush,
  type VapidKeys,
  type WebPushSubscription,
} from "./web-push";

/** A page that is on screen reports in at least this often. */
const PRESENCE_TTL_MS = 75_000;

/** Open Nakama pages one user can have; more only means fewer pushes held back. */
const MAX_PRESENCE_CLIENTS = 32;

export interface WebPushMessage {
  body: string;
  /** Same tag replaces the earlier notification for that chat. */
  tag: string;
  title: string;
  url: string;
}

interface WebPushState {
  /** By user id. */
  subscriptions: Record<string, WebPushSubscription[]>;
  vapid: VapidKeys | null;
}

/**
 * Push subscriptions and the VAPID key pair, in one file under the config dir
 * (it holds a private key, so 0600). Presence lives in memory only.
 */
export class WebPushService {
  private state: Promise<WebPushState> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private vapidReady: Promise<VapidKeys> | null = null;
  private readonly presence = new Map<string, Map<string, number>>();

  constructor(private readonly path?: string) {}

  private filePath(): string {
    return this.path ?? join(getUserConfigDir(), "web-push.json");
  }

  private load(): Promise<WebPushState> {
    if (this.state) {
      return this.state;
    }

    const pending = this.readState();
    this.state = pending;

    // Not cached: a read that failed for a passing reason is tried again.
    pending.catch(() => {
      if (this.state === pending) {
        this.state = null;
      }
    });

    return pending;
  }

  private async readState(): Promise<WebPushState> {
    const path = this.filePath();
    let raw: string;

    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      // Only a missing file means "nothing yet". Any other read error must not
      // lead to fresh VAPID keys overwriting every saved subscription.
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { subscriptions: {}, vapid: null };
      }

      throw error;
    }

    try {
      // SAFETY: only this service writes the file, always from a WebPushState.
      return JSON.parse(raw) as WebPushState;
    } catch {
      // Unreadable, so its key and subscriptions are lost anyway. Keep it for
      // the operator and start again, instead of failing every push for good.
      await rename(path, `${path}.corrupt-${Date.now()}`);
      console.warn(`${path} was not valid JSON; moved it aside.`);

      return { subscriptions: {}, vapid: null };
    }
  }

  private async save(state: WebPushState): Promise<void> {
    const path = this.filePath();

    const write = this.saving.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      // Write then rename, so a crash mid-write cannot leave half a file.
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temp, path);
    });

    // One failed write must not fail every later one.
    this.saving = write.catch(() => undefined);
    await write;
  }

  /** Persisted on first read: a browser that subscribed with it must keep it. */
  async publicKey(): Promise<string> {
    this.vapidReady ??= this.loadVapidKeys();

    try {
      return (await this.vapidReady).publicKey;
    } catch (error) {
      // Let the next call retry instead of failing forever.
      this.vapidReady = null;
      throw error;
    }
  }

  private async loadVapidKeys(): Promise<VapidKeys> {
    const state = await this.load();

    if (!state.vapid) {
      state.vapid = await generateVapidKeys();
      await this.save(state);
    }

    return state.vapid;
  }

  async subscribe(
    userId: string,
    subscription: WebPushSubscription
  ): Promise<void> {
    await this.publicKey();
    const state = await this.load();
    // One browser has one endpoint, and whoever subscribed it last owns it.
    dropEndpoint(state, subscription.endpoint);
    state.subscriptions[userId] = [
      ...(state.subscriptions[userId] ?? []),
      subscription,
    ];
    await this.save(state);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const state = await this.load();
    const before = state.subscriptions[userId]?.length ?? 0;
    dropEndpoint(state, endpoint, userId);

    if ((state.subscriptions[userId]?.length ?? 0) !== before) {
      await this.save(state);
    }
  }

  setPresence(userId: string, clientId: string, visible: boolean): void {
    const clients = this.presence.get(userId) ?? new Map<string, number>();
    const now = Date.now();

    // Pages that closed without saying so would otherwise stay here for good.
    for (const [id, expiresAt] of clients) {
      if (expiresAt <= now) {
        clients.delete(id);
      }
    }

    if (
      visible &&
      (clients.has(clientId) || clients.size < MAX_PRESENCE_CLIENTS)
    ) {
      clients.set(clientId, now + PRESENCE_TTL_MS);
    } else {
      clients.delete(clientId);
    }

    if (clients.size === 0) {
      this.presence.delete(userId);
    } else {
      this.presence.set(userId, clients);
    }
  }

  private isPresent(userId: string): boolean {
    const clients = this.presence.get(userId);
    const now = Date.now();

    for (const [clientId, expiresAt] of clients ?? []) {
      if (expiresAt > now) {
        return true;
      }

      clients?.delete(clientId);
    }

    return false;
  }

  /**
   * Sends to every device the user subscribed, unless Nakama is on screen on
   * one of them: they are already looking, and a push would only echo it.
   */
  async notify(userId: string, message: WebPushMessage): Promise<void> {
    if (this.isPresent(userId)) {
      return;
    }

    const state = await this.load();
    const subscriptions = state.subscriptions[userId] ?? [];

    if (!state.vapid || subscriptions.length === 0) {
      return;
    }

    const publicUrl = resolveWebPublicUrl();

    // VAPID wants an https: or mailto: contact for the push service operator.
    const subject = publicUrl?.startsWith("https:")
      ? publicUrl
      : "mailto:nakama@localhost";

    const payload = JSON.stringify(message);
    const vapid = state.vapid;

    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        sendWebPush(subscription, payload, vapid, subject)
      )
    );

    let dropped = false;

    for (const [index, result] of results.entries()) {
      const endpoint = subscriptions[index]?.endpoint ?? "";

      if (result.status === "rejected") {
        console.warn(
          `Web push to ${new URL(endpoint).host} failed:`,
          result.reason
        );
      } else if (result.value === "gone") {
        dropEndpoint(state, endpoint);
        dropped = true;
      }
    }

    if (dropped) {
      await this.save(state);
    }
  }
}

function dropEndpoint(
  state: WebPushState,
  endpoint: string,
  onlyUserId?: string
): void {
  for (const [userId, list] of Object.entries(state.subscriptions)) {
    if (onlyUserId && userId !== onlyUserId) {
      continue;
    }

    const kept = list.filter((entry) => entry.endpoint !== endpoint);

    if (kept.length === 0) {
      delete state.subscriptions[userId];
    } else {
      state.subscriptions[userId] = kept;
    }
  }
}

export const webPushService = new WebPushService();
