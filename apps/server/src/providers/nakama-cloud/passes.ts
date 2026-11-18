import { randomUUID } from "node:crypto";
import { NakamaApiError } from "@nakama/core";
import { z } from "zod";
import {
  computerTokenPayload,
  LLM_TOKEN_PATH,
} from "../../services/computer-auth";

/** Renew a pass this long before it ends, so a call never starts on a dying pass. */
const RENEW_BEFORE_MS = 60 * 1000;

const passResponseSchema = z.object({
  expiresAt: z.number(),
  pass: z.string(),
});

const clockSkewSchema = z.object({ serverTime: z.number() });

export const SIGN_IN_AGAIN =
  "Nakama Cloud refused this computer. Sign in again in Settings.";

export const CLOUD_UNREACHABLE = "Can't reach Nakama Cloud";

export interface NakamaCloudPassOptions {
  baseUrl: string;
  computerId: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Signs bytes with this computer's Ed25519 device key; returns base64. */
  sign: (payload: Buffer) => Promise<string>;
}

/**
 * Gets and caches the short-lived pass for one computer. A refused request
 * means the computer was removed or the member left: the person must sign
 * in again.
 */
export class NakamaCloudPasses {
  /** Cloud time minus this computer's time, learned from a refused request. */
  private clockOffsetMs = 0;
  private confirmCode: string | null = null;
  private refusedByCloud = false;
  private current: { expiresAt: number; pass: string } | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly options: NakamaCloudPassOptions) {}

  /** The cloud's time, as near as this computer knows it. */
  private now(): number {
    return (this.options.now ?? Date.now)() + this.clockOffsetMs;
  }

  async get(): Promise<string> {
    if (this.current && this.current.expiresAt - RENEW_BEFORE_MS > this.now()) {
      return this.current.pass;
    }

    // Parallel calls share one token request.
    this.pending ??= this.request().finally(() => {
      this.pending = null;
    });

    return this.pending;
  }

  /**
   * The cloud refused this computer (removed, member gone, password
   * changed): only a new sign-in helps. Status shows it.
   */
  get refused(): boolean {
    return this.refusedByCloud;
  }

  refuse(): void {
    this.refusedByCloud = true;
    this.current = null;
  }

  /** The one-time code from Connect; the next token request sends it. */
  confirmWith(code: string): void {
    this.confirmCode = code;
    this.current = null;
    this.refusedByCloud = false;
  }

  /** Forget the cached pass, for example after the cloud restarted. */
  invalidate(): void {
    this.current = null;
  }

  private async request(retried = false): Promise<string> {
    const unsigned = {
      computerId: this.options.computerId,
      nonce: randomUUID(),
      timestamp: this.now(),
    };

    const signature = await this.options.sign(
      computerTokenPayload(unsigned, { method: "POST", path: LLM_TOKEN_PATH })
    );

    let response: Response;

    try {
      response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl}${LLM_TOKEN_PATH}`,
        {
          body: JSON.stringify(
            this.confirmCode
              ? { ...unsigned, confirmCode: this.confirmCode, signature }
              : { ...unsigned, signature }
          ),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
    } catch {
      throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
    }

    if (response.status === 401) {
      const skew = clockSkewSchema.safeParse(
        await response.json().catch(() => null)
      );

      // This computer's clock is off: take the cloud's time and sign again.
      if (skew.success && !retried) {
        this.clockOffsetMs =
          skew.data.serverTime - (this.options.now ?? Date.now)();

        return this.request(true);
      }

      this.refuse();
      throw new NakamaApiError(SIGN_IN_AGAIN, 401);
    }

    if (!response.ok) {
      throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
    }

    this.current = passResponseSchema.parse(await response.json());
    this.confirmCode = null;

    return this.current.pass;
  }
}
