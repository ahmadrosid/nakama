import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/lib/client";
import {
  fetchReleaseNotes,
  findReleaseNote,
  type ReleaseNote,
} from "@/lib/release-notes";

const SERVICE_WORKER_URL = "/sw.js";

/** A standalone install can stay open for days, so re-check on each return. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** A deploy can answer 5xx for a short time while the server restarts. */
const NOTES_ATTEMPTS = 3;

const NOTES_RETRY_MS = 10_000;

function readServerVersion(): Promise<string | null> {
  return client
    .health()
    .then((health) => health.version.trim() || null)
    .catch(() => null);
}

async function loadReleaseNotes(
  isDisposed: () => boolean
): Promise<ReleaseNote[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchReleaseNotes();
    } catch {
      if (attempt >= NOTES_ATTEMPTS || isDisposed()) {
        return [];
      }

      await new Promise((resolve) =>
        setTimeout(resolve, NOTES_RETRY_MS * attempt)
      );
    }
  }
}

interface ServiceWorkerUpdate {
  applyUpdate: () => void;
  /** Plain-language notes for the waiting build, when the release has them. */
  note: ReleaseNote | null;
  updateReady: boolean;
  /** Version the server now runs, read once a newer build is waiting. */
  version: string | null;
}

/**
 * Registers the service worker and reports when a newer build is waiting.
 * The reload is deliberate rather than automatic: swapping the worker under a
 * live page would leave it asking for chunks the new build no longer ships.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);
  /** Version the server ran when this page loaded: the page's own build. */
  const loadedVersionRef = useRef<Promise<string | null> | null>(null);

  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  const [installing, setInstalling] = useState<ServiceWorker | null>(null);

  const [version, setVersion] = useState<string | null>(null);
  const [note, setNote] = useState<ReleaseNote | null>(null);

  useEffect(() => {
    if (!(import.meta.env.PROD && "serviceWorker" in navigator)) {
      return;
    }

    const container = navigator.serviceWorker;
    let disposed = false;
    loadedVersionRef.current = readServerVersion();

    const handleControllerChange = () => {
      if (reloadingRef.current) {
        window.location.reload();
      }
    };

    container.addEventListener("controllerchange", handleControllerChange);
    container
      .register(SERVICE_WORKER_URL, { scope: "/" })
      .then((current) => {
        if (!disposed) {
          setRegistration(current);
        }
      })
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error causes may come from browser or network code and are narrowed by this handler.
      .catch((error: unknown) => {
        console.warn("Service worker registration failed:", error);
      });

    return () => {
      disposed = true;
      container.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  useEffect(() => {
    if (!registration) {
      return;
    }

    let lastCheck = Date.now();
    const handleUpdateFound = () => setInstalling(registration.installing);

    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS
      ) {
        return;
      }

      lastCheck = Date.now();
      void registration.update().catch(() => undefined);
    };

    registration.addEventListener("updatefound", handleUpdateFound);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (registration.waiting && navigator.serviceWorker.controller) {
      setWaiting(registration.waiting);
    }

    handleUpdateFound();

    return () => {
      registration.removeEventListener("updatefound", handleUpdateFound);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [registration]);

  useEffect(() => {
    if (!installing) {
      return;
    }

    const handleStateChange = () => {
      // First installation has no existing controller and needs no reload prompt.
      if (
        installing.state === "installed" &&
        navigator.serviceWorker.controller
      ) {
        setWaiting(installing);
      }
    };

    installing.addEventListener("statechange", handleStateChange);
    handleStateChange();

    return () =>
      installing.removeEventListener("statechange", handleStateChange);
  }, [installing]);

  useEffect(() => {
    if (!waiting) {
      return;
    }

    let disposed = false;

    // The server already runs the new build, so its health and notes are new.
    Promise.all([
      readServerVersion(),
      loadReleaseNotes(() => disposed),
      loadedVersionRef.current ?? Promise.resolve(null),
    ]).then(([next, notes, loaded]) => {
      if (disposed) {
        return;
      }

      const found = findReleaseNote(notes, next, loaded);
      setVersion(next ?? found?.version ?? null);
      setNote(found);
    });

    return () => {
      disposed = true;
    };
  }, [waiting]);

  const applyUpdate = useCallback(() => {
    if (!waiting) {
      return;
    }

    reloadingRef.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  return { applyUpdate, note, updateReady: waiting !== null, version };
}
