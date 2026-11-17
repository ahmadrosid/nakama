import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  type ComputerTokenRequest,
  computerTokenPayload,
  LLM_TOKEN_PATH,
} from "../services/computer-auth";

/** A test computer: an Ed25519 key pair and a signer for token requests. */
export function testDeviceKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // The raw key is the last 32 bytes of the SPKI DER encoding.
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);

  return {
    publicKey: raw.toString("base64"),
    /** Signs bytes as Nakama Desktop does; base64. */
    sign: (payload: Buffer): string =>
      sign(null, payload, privateKey).toString("base64"),
    signRequest: (
      computerId: string,
      options: { confirmCode?: string; nonce?: string; timestamp?: number } = {}
    ): ComputerTokenRequest => {
      const request = {
        computerId,
        nonce: options.nonce ?? randomUUID(),
        timestamp: options.timestamp ?? Date.now(),
      };

      const signature = sign(
        null,
        computerTokenPayload(request, { method: "POST", path: LLM_TOKEN_PATH }),
        privateKey
      ).toString("base64");

      return options.confirmCode
        ? { ...request, confirmCode: options.confirmCode, signature }
        : { ...request, signature };
    },
  };
}
