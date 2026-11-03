import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { hostname } from "node:os";
import type { CustomModelEntry, NakamaCloudAccount } from "@nakama/core";
import { z } from "zod";
import type { ManagedSecrets } from "../../services/managed-secrets";
import { NakamaCloudPasses } from "./passes";

export const NAKAMA_CLOUD_PROVIDER_ID = "nakama-cloud";

const SECRET_SCOPE = "global";

const DEVICE_KEY_SECRET = "nakama-cloud-device-key";

const INSTALL_ID_SECRET = "nakama-cloud-install-id";

/** A sign-in link that is not used stops working after this long. */
const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

const modelsSchema = z.object({
  models: z.array(
    z.object({
      default: z.boolean().optional(),
      id: z.string(),
      name: z.string(),
      providerId: z.string().optional(),
    })
  ),
});

export interface NakamaCloudConnection {
  account: NakamaCloudAccount;
  cloudUrl: string;
  models: CustomModelEntry[];
}

interface DeviceKey {
  installId: string;
  privateKey: KeyObject;
  publicKey: string;
}

const CALLBACK_PAGE = `<!doctype html><meta charset="utf-8"><title>Nakama</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh">
<p>Nakama Desktop is connected. You can close this tab.</p></body>`;

const RETRY_PAGE = `<!doctype html><meta charset="utf-8"><title>Nakama</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh">
<p>Nakama Desktop could not finish. Reload this page to try again.</p></body>`;

const FAILED_PAGE = `<!doctype html><meta charset="utf-8"><title>Nakama</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh">
<p>This sign-in link is not valid. Start again from Nakama Desktop.</p></body>`;

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Signs this computer in to Nakama Cloud in the person's own browser. The
 * Connect page sends the result back to a one-time 127.0.0.1 address
 * (RFC 8252), with a state value only this computer knows.
 */
export class NakamaCloudSignIn {
  private key: Promise<DeviceKey> | null = null;
  private listener: { stop: (force?: boolean) => void } | null = null;
  private readonly passes = new Map<string, NakamaCloudPasses>();

  constructor(
    private readonly secrets: ManagedSecrets,
    private readonly onConnected: (
      connection: NakamaCloudConnection
    ) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** The device key, made one time and kept in the encrypted secrets store. */
  private deviceKey(): Promise<DeviceKey> {
    this.key ??= this.loadOrCreateKey().catch((error: Error) => {
      this.key = null;
      throw error;
    });

    return this.key;
  }

  private async loadOrCreateKey(): Promise<DeviceKey> {
    const stored = await this.secrets.resolve(SECRET_SCOPE, DEVICE_KEY_SECRET);
    const install = await this.secrets.resolve(SECRET_SCOPE, INSTALL_ID_SECRET);

    if (stored.value && install.value) {
      const privateKey = createPrivateKey({
        format: "der",
        key: Buffer.from(stored.value, "base64"),
        type: "pkcs8",
      });

      return {
        installId: install.value,
        privateKey,
        publicKey: rawPublicKey(privateKey),
      };
    }

    const { privateKey } = generateKeyPairSync("ed25519");
    const installId = `install_${randomUUID()}`;

    await this.secrets.save(
      SECRET_SCOPE,
      DEVICE_KEY_SECRET,
      privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")
    );
    await this.secrets.save(SECRET_SCOPE, INSTALL_ID_SECRET, installId);

    return { installId, privateKey, publicKey: rawPublicKey(privateKey) };
  }

  /** Passes for a signed-in Nakama Cloud instance, one cache per computer. */
  passesFor(cloudUrl: string, computerId: string): NakamaCloudPasses {
    const cacheKey = `${cloudUrl} ${computerId}`;
    const cached = this.passes.get(cacheKey);

    if (cached) {
      return cached;
    }

    const passes = new NakamaCloudPasses({
      baseUrl: cloudUrl,
      computerId,
      fetch: this.fetchImpl,
      sign: async (payload) =>
        sign(null, payload, (await this.deviceKey()).privateKey).toString(
          "base64"
        ),
    });

    this.passes.set(cacheKey, passes);

    return passes;
  }

  /**
   * Opens the one-time listener and returns the Connect page address to open
   * in the browser. A new start replaces an unfinished one.
   */
  async start(input: {
    cloudUrl: string;
    computerName?: string;
  }): Promise<{ connectUrl: string }> {
    this.stop();

    const key = await this.deviceKey();
    const state = randomBytes(24).toString("base64url");
    const cloudUrl = new URL(input.cloudUrl).origin;

    const server = Bun.serve({
      fetch: async (request) => {
        const url = new URL(request.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const params = url.searchParams;
        const computerId = params.get("computerId")?.trim() ?? "";
        const confirmCode = params.get("confirmCode")?.trim() ?? "";

        // A cancelled or replaced sign-in (a request on a kept-open
        // connection) must not use the code: that would activate the computer.
        if (
          !(
            this.listener === server &&
            sameText(params.get("state") ?? "", state) &&
            computerId &&
            confirmCode
          )
        ) {
          return new Response(FAILED_PAGE, {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 400,
          });
        }

        // The listener stays open on a failure, so a reload of this page retries.
        try {
          this.passesFor(cloudUrl, computerId).confirmWith(confirmCode);
          const models = await this.cloudModels(cloudUrl, computerId);

          // Cancelled or replaced while the models loaded: the computer is
          // active in the cloud now, so remove it there and do not sign in.
          if (this.listener !== server) {
            await this.revoke(cloudUrl, computerId);

            return new Response(FAILED_PAGE, {
              headers: { "content-type": "text/html; charset=utf-8" },
              status: 400,
            });
          }

          await this.onConnected({
            account: {
              account: params.get("account")?.trim() ?? "",
              computerId,
              orgId: params.get("orgId")?.trim() ?? "",
              orgName: params.get("orgName")?.trim() ?? "",
            },
            cloudUrl,
            models,
          });
        } catch {
          return new Response(RETRY_PAGE, {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 502,
          });
        }

        this.stop();

        return new Response(CALLBACK_PAGE, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
      hostname: "127.0.0.1",
      port: 0,
    });

    this.listener = server;
    setTimeout(() => {
      if (this.listener === server) {
        this.stop();
      }
    }, SIGN_IN_WINDOW_MS).unref();

    const connectUrl = new URL("/desktop/connect", cloudUrl);
    connectUrl.searchParams.set("install", key.installId);
    connectUrl.searchParams.set("key", key.publicKey);
    connectUrl.searchParams.set(
      "name",
      input.computerName?.trim() || hostname().replace(/\.local$/i, "")
    );
    connectUrl.searchParams.set(
      "return",
      `http://127.0.0.1:${server.port}/callback`
    );
    connectUrl.searchParams.set("state", state);

    return { connectUrl: connectUrl.toString() };
  }

  /** Sign out: this computer removes itself in the cloud. Best effort. */
  async revoke(cloudUrl: string, computerId: string): Promise<void> {
    const passes = this.passesFor(cloudUrl, computerId);

    try {
      const pass = await passes.get();

      await this.fetchImpl(`${cloudUrl}/v1/llm/computer`, {
        headers: { authorization: `Bearer ${pass}` },
        method: "DELETE",
      });
    } catch {
      // Offline or already removed: the local sign-out still happens.
    }

    this.passes.delete(`${cloudUrl} ${computerId}`);
  }

  stop(): void {
    // Not forced: the callback response still has to reach the browser.
    this.listener?.stop();
    this.listener = null;
  }

  /** The team's models, as model entries of the Nakama Cloud provider. */
  async cloudModels(
    cloudUrl: string,
    computerId: string
  ): Promise<CustomModelEntry[]> {
    const pass = await this.passesFor(cloudUrl, computerId).get();

    const response = await this.fetchImpl(`${cloudUrl}/v1/llm/models`, {
      headers: { authorization: `Bearer ${pass}` },
    });

    // No models is no sign-in: the callback shows the retry page instead.
    if (!response.ok) {
      throw new Error(`Nakama Cloud models: HTTP ${response.status}`);
    }

    return modelsSchema.parse(await response.json()).models.map((model) => {
      // The cloud resolves "<its provider>::<model>" back to its own provider.
      const entry: CustomModelEntry = {
        id: model.providerId ? `${model.providerId}::${model.id}` : model.id,
        name: model.name,
      };

      // Saved config takes JSON values only, so no undefined fields.
      if (model.default) {
        entry.default = true;
      }

      return entry;
    });
  }
}

/** The server's one sign-in, so every provider factory call finds its passes. */
let active: NakamaCloudSignIn | null = null;

export function useNakamaCloudSignIn(signIn: NakamaCloudSignIn | null): void {
  active = signIn;
}

export function activeNakamaCloudPasses(instance: {
  baseUrl?: string;
  nakamaCloud?: NakamaCloudAccount;
}): NakamaCloudPasses | null {
  return active && instance.baseUrl && instance.nakamaCloud
    ? active.passesFor(instance.baseUrl, instance.nakamaCloud.computerId)
    : null;
}

function rawPublicKey(privateKey: KeyObject): string {
  return createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
}
