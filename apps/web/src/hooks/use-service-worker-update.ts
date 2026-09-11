import { useCallback, useEffect, useRef, useState } from "react";

const SERVICE_WORKER_URL = "/sw.js";
/** A standalone install can stay open for days, so re-check on each return. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface ServiceWorkerUpdate {
  applyUpdate: () => void;
  updateReady: boolean;
}

/**
 * Registers the service worker and reports when a newer build is waiting.
 * The reload is deliberate rather than automatic: swapping the worker under a
 * live page would leave it asking for chunks the new build no longer ships.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!(import.meta.env.PROD && "serviceWorker" in navigator)) {
      return;
    }

    const container = navigator.serviceWorker;
    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = Date.now();

    const handleControllerChange = () => {
      if (reloadingRef.current) {
        window.location.reload();
      }
    };

    const trackInstalling = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        // No existing controller means this is the very first install, which
        // is not an update the user needs to be told about.
        if (worker.state === "installed" && container.controller) {
          setWaiting(worker);
        }
      });
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS
      ) {
        return;
      }
      lastCheck = Date.now();
      void registration?.update().catch(() => undefined);
    };

    container.addEventListener("controllerchange", handleControllerChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    container
      .register(SERVICE_WORKER_URL, { scope: "/" })
      .then((current) => {
        if (disposed) {
          return;
        }
        registration = current;

        if (current.waiting && container.controller) {
          setWaiting(current.waiting);
        }

        current.addEventListener("updatefound", () => {
          const installing = current.installing;
          if (installing) {
            trackInstalling(installing);
          }
        });
      })
      .catch((error: unknown) => {
        console.warn("Service worker registration failed:", error);
      });

    return () => {
      disposed = true;
      container.removeEventListener("controllerchange", handleControllerChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting) {
      return;
    }
    reloadingRef.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  return { applyUpdate, updateReady: waiting !== null };
}
