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

  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [installing, setInstalling] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!(import.meta.env.PROD && "serviceWorker" in navigator)) {
      return;
    }
    const container = navigator.serviceWorker;
    let disposed = false;
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

  const applyUpdate = useCallback(() => {
    if (!waiting) {
      return;
    }
    reloadingRef.current = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  }, [waiting]);

  return { applyUpdate, updateReady: waiting !== null };
}
