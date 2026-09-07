/// <reference lib="webworker" />

import {
  cacheNameFor,
  classifyRequest,
  shouldCacheResponse,
  staleCacheNames,
} from "../src/lib/sw-strategy";

declare const self: ServiceWorkerGlobalScope;

/** Both are replaced by `scripts/build-sw.ts` at build time. */
declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: string;

const VERSION = __SW_VERSION__;
const PRECACHE_URLS = JSON.parse(__SW_PRECACHE__) as string[];
const CACHE_NAME = cacheNameFor(VERSION);
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(takeOver());
});

self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const strategy = classifyRequest(
    {
      method: event.request.method,
      mode: event.request.mode,
      url: event.request.url,
    },
    self.location.origin
  );

  if (strategy === "passthrough") {
    return;
  }

  if (strategy === "shell") {
    event.respondWith(shellFirst(event.request));
    return;
  }

  if (strategy === "immutable") {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event));
});

async function precache(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  // One missing file must not fail the whole install, so they are added
  // individually rather than through `addAll`.
  await Promise.allSettled(
    PRECACHE_URLS.map((url) =>
      cache.add(
        new Request(url, { cache: "reload", credentials: "same-origin" })
      )
    )
  );
}

async function takeOver(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    staleCacheNames(names, VERSION).map((name) => caches.delete(name))
  );
  await self.clients.claim();
}

/**
 * Navigations always try the network, so a deployed build (and any auth
 * redirect in front of it) wins over the cached shell. The cache is the
 * offline fallback only.
 */
async function shellFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (shouldCacheResponse(response)) {
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(SHELL_URL);
    return cached ?? new Response("Offline", { status: 503 });
  }
}

/** Content-hashed URL: a hit is always the right bytes. */
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (shouldCacheResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

/** Unhashed URL: serve the copy we have, refresh it for next time. */
async function staleWhileRevalidate(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);

  const refresh = fetch(event.request)
    .then(async (response) => {
      if (shouldCacheResponse(response)) {
        await cache.put(event.request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }

  const response = await refresh;
  return response ?? Response.error();
}
