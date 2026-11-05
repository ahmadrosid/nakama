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
    code: details.code,
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
      const signal = init?.signal;

      if (signal?.aborted) {
        reject(abortedError());

        return;
      }

      xhr.open(init?.method ?? "POST", String(input));
      xhr.withCredentials = init?.credentials === "include";

      for (const [name, value] of new Headers(init?.headers)) {
        xhr.setRequestHeader(name, value);
      }

      const abort = () => xhr.abort();
      signal?.addEventListener("abort", abort, { once: true });

      const fail = (error: Error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      };

      const interrupted = () => {
        fail(
          new Error(
            "The upload was interrupted. Check the connection and try again."
          )
        );
      };

      xhr.upload.onprogress = (event) => {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      };

      xhr.onerror = interrupted;
      xhr.ontimeout = interrupted;

      xhr.onabort = () => {
        if (signal?.aborted) {
          fail(abortedError());
        } else {
          interrupted();
        }
      };

      xhr.onload = () => {
        signal?.removeEventListener("abort", abort);
        resolve(
          new Response(
            NULL_BODY_STATUSES.has(xhr.status) ? null : xhr.responseText,
            {
              headers: parseXhrHeaders(xhr.getAllResponseHeaders()),
              status: xhr.status,
            }
          )
        );
      };

      // SAFETY: the only caller passes a Blob or BufferSource, both valid for XHR.
      xhr.send(init?.body as XMLHttpRequestBodyInit);
    });
}

function abortedError(): Error {
  return new DOMException("The upload was aborted.", "AbortError");
}

// A Response with one of these statuses must not have a body.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function parseXhrHeaders(raw: string): Headers {
  const headers = new Headers();

  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");

    if (separator > 0) {
      headers.append(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim()
      );
    }
  }

  return headers;
}

export async function readBodyWithProgress(
  response: Response,
  onProgress?: TransferProgress
): Promise<ArrayBuffer> {
  if (!(onProgress && response.body)) {
    return response.arrayBuffer();
  }

  const total = Number(response.headers.get("Content-Length") ?? 0);
  // With a known size, write into one buffer so the tab holds the archive once.
  const data = new Uint8Array(total > 0 ? total : 0);
  const extra: Uint8Array[] = [];
  let loaded = 0;
  onProgress(0, total);

  // A reader, not `for await`: Safari cannot iterate a ReadableStream.
  const reader = response.body.getReader();

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (extra.length === 0 && loaded + value.byteLength <= data.byteLength) {
      data.set(value, loaded);
    } else {
      // The size is unknown or the header was wrong: keep the rest as chunks.
      extra.push(value);
    }

    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  if (extra.length === 0) {
    return data.byteLength === loaded
      ? data.buffer
      : data.slice(0, loaded).buffer;
  }

  const filled =
    loaded - extra.reduce((sum, chunk) => sum + chunk.byteLength, 0);

  const joined = new Uint8Array(loaded);
  joined.set(data.subarray(0, filled), 0);
  let offset = filled;

  for (const chunk of extra) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined.buffer;
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
