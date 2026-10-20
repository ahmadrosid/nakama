import { NakamaApiError, readApiErrorDetails } from "@nakama/core/api-error";
import type { OrgPluginSummary } from "@nakama/core/contract";

export type JsonValue =
  | boolean
  | JsonValue[]
  | number
  | null
  | string
  | { [key: string]: JsonValue };

export type OfficialPluginInstallResponse = { install: OrgPluginSummary };

export async function createApiError(
  response: Response,
  path: string
): Promise<NakamaApiError> {
  const details = await readApiErrorDetails(response);

  return new NakamaApiError(details.message, response.status, path, undefined, {
    totpEnabled: details.totpEnabled,
  });
}

export function isMutatingMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export async function encodeArchiveData(
  data: Blob | BufferSource | string
): Promise<string> {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This public helper accepts a typed string-or-binary union, not untrusted JSON.
  if (typeof data === "string") {
    return data;
  }

  if (isBlobLike(data)) {
    return encodeArchiveData(await data.arrayBuffer());
  }

  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Feature detection selects browser btoa or the Node Buffer fallback.
  if (typeof btoa === "function") {
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

export function readContentDispositionFilename(
  headers: Headers
): string | null {
  const contentDisposition = headers.get("content-disposition");
  const match = contentDisposition?.match(/filename="([^"]+)"/i);

  return match?.[1] ?? null;
}

function isBlobLike(value: Blob | BufferSource): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}
