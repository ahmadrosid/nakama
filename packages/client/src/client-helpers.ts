import { NakamaApiError, readApiErrorDetails } from "@nakama/core/api-error";
import type { OrgPluginSummary } from "@nakama/core/contract";
import type { NakamaClientOptions, TransferProgress } from "./types";

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

/** fetch() reports no upload progress, so a browser upload that wants it uses XHR. */
export function createUploadFetch(
  onProgress: TransferProgress
): NonNullable<NakamaClientOptions["fetch"]> {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(init?.method ?? "POST", String(input));
      xhr.withCredentials = init?.credentials === "include";

      for (const [name, value] of new Headers(init?.headers)) {
        xhr.setRequestHeader(name, value);
      }

      xhr.upload.onprogress = (event) => {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      };

      xhr.onerror = () => {
        reject(
          new Error(
            "The upload was interrupted. Check the connection and try again."
          )
        );
      };

      xhr.onload = () => {
        resolve(
          new Response(xhr.responseText, {
            headers: {
              "Content-Type":
                xhr.getResponseHeader("Content-Type") ?? "application/json",
            },
            status: xhr.status,
          })
        );
      };
      // SAFETY: the only caller passes a Blob or BufferSource, both valid for XHR.

      xhr.send(init?.body as XMLHttpRequestBodyInit);
    });
}

export async function readBodyWithProgress(
  response: Response,
  onProgress?: TransferProgress
): Promise<ArrayBuffer> {
  if (!(onProgress && response.body)) {
    return response.arrayBuffer();
  }

  const total = Number(response.headers.get("Content-Length") ?? 0);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, total);

  // A reader, not `for await`: Safari cannot iterate a ReadableStream.
  const reader = response.body.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  const data = new Uint8Array(loaded);
  let offset = 0;

  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return data.buffer;
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
