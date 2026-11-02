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

export const SIGN_IN_AGAIN = "Sign in again";

export const CLOUD_UNREACHABLE = "Can't reach Nakama Cloud";

export interface NakamaCloudPassOptions {
  baseUrl: string;
  computerId: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Signs bytes with this computer's Ed25519 device key; returns base64. */
  sign: (payload: Buffer) => string;
}

/**
 * Gets and caches the short-lived pass for one computer. A refused request
 * means the computer was removed or the member left: the person must sign
 * in again.
 */
export class NakamaCloudPasses {
  private current: { expiresAt: number; pass: string } | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly options: NakamaCloudPassOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
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

  /** Forget the cached pass, for example after the cloud restarted. */
  invalidate(): void {
    this.current = null;
  }

  private async request(): Promise<string> {
    const unsigned = {
      computerId: this.options.computerId,
      nonce: randomUUID(),
      timestamp: this.now(),
    };

    const signature = this.options.sign(
      computerTokenPayload(unsigned, { method: "POST", path: LLM_TOKEN_PATH })
    );

    let response: Response;

    try {
      response = await (this.options.fetch ?? fetch)(
        `${this.options.baseUrl}${LLM_TOKEN_PATH}`,
        {
          body: JSON.stringify({ ...unsigned, signature }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
    } catch {
      throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
    }

    if (response.status === 401) {
      throw new NakamaApiError(SIGN_IN_AGAIN, 401);
    }

    if (!response.ok) {
      throw new NakamaApiError(CLOUD_UNREACHABLE, 503);
    }

    this.current = passResponseSchema.parse(await response.json());

    return this.current.pass;
  }
}
