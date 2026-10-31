import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";

/** Fired after this device's subscription changes, so every switch re-reads it. */
const WEB_PUSH_CHANGED = "nakama:web-push-changed";

let resyncedThisPage = false;

/** How often an on-screen page tells the server; the server forgets after 75s. */
const PRESENCE_INTERVAL_MS = 30_000;

export const webPushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function toStoredSubscription(subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON();

  if (!(endpoint && keys?.auth && keys.p256dh)) {
    throw new Error("The browser returned an incomplete push subscription.");
  }

  return { endpoint, keys: { auth: keys.auth, p256dh: keys.p256dh } };
}

/**
 * Subscribed fresh each time, so a rotated server key cannot strand it. The
 * subscription is meant to outlive the page: only the switch turns it off.
 */
async function subscribeThisDevice(
  registration: ServiceWorkerRegistration
): Promise<void> {
  const subscription = await registration.pushManager.subscribe({
    applicationServerKey: urlBase64ToBytes(await client.getPushPublicKey()),
    userVisibleOnly: true,
  });

  try {
    await client.savePushSubscription(toStoredSubscription(subscription));
  } catch (err) {
    // The server cannot push to it, so the switch must not read as on.
    await subscription.unsubscribe();
    throw err;
  }
}

/** Drops this device's subscription on the server and in the browser. */
export async function forgetThisDevicePush(
  registration: ServiceWorkerRegistration | undefined
): Promise<void> {
  const existing = await registration?.pushManager.getSubscription();

  if (!existing) {
    return;
  }

  await client.deletePushSubscription(existing.endpoint).catch(() => {
    // The server may already have dropped it; the browser side still goes.
  });
  await existing.unsubscribe();
}

/**
 * A notification for a chat in another org carries `?org=`. The chat waits
 * (true) until that org is active, or every lookup in it answers 404.
 */
export function useOrgFromNotification(): boolean {
  const { activeOrg, orgs, switchOrg } = useAuth();
  const [params, setParams] = useSearchParams();
  const wanted = params.get("org");
  const [failed, setFailed] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);

  const switching =
    wanted !== null &&
    wanted !== failed &&
    wanted !== activeOrg?.id &&
    orgs.some((org) => org.id === wanted);

  useEffect(() => {
    if (wanted === null) {
      return;
    }

    if (!switching) {
      setParams(
        (current) => {
          current.delete("org");

          return current;
        },
        { replace: true }
      );

      return;
    }

    // Once per org: switchOrg changes identity while the switch settles.
    if (startedRef.current === wanted) {
      return;
    }

    startedRef.current = wanted;
    switchOrg(wanted).catch(() => setFailed(wanted));
  }, [setParams, switchOrg, switching, wanted]);

  return switching;
}

/** This device's "notify me when a reply is ready" switch. */
export function useWebPush() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!webPushSupported) {
      setEnabled(false);

      return;
    }

    let cancelled = false;

    const read = () => {
      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then(async (subscription) => {
          const on =
            subscription !== null && Notification.permission === "granted";

          // Once per page load: the server may have refused or lost this
          // subscription, and a switch that reads "on" must mean it can push.
          if (subscription && on && !resyncedThisPage) {
            resyncedThisPage = true;
            await client.savePushSubscription(
              toStoredSubscription(subscription)
            );
          }

          if (!cancelled) {
            setEnabled(on);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setEnabled(false);
          }
        });
    };

    read();
    window.addEventListener(WEB_PUSH_CHANGED, read);

    return () => {
      cancelled = true;
      window.removeEventListener(WEB_PUSH_CHANGED, read);
    };
  }, []);

  const setPush = useCallback(async (next: boolean) => {
    setBusy(true);
    setError(null);

    try {
      // First, while the tap still counts: Safari only asks inside a user gesture.
      if (next && (await Notification.requestPermission()) !== "granted") {
        setError(
          "Notifications are blocked for this site. Allow them in the browser settings."
        );
        setEnabled(false);

        return;
      }

      const registration = await navigator.serviceWorker.ready;
      await forgetThisDevicePush(registration);

      if (!next) {
        setEnabled(false);

        return;
      }

      await subscribeThisDevice(registration);
      setEnabled(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event(WEB_PUSH_CHANGED));
    }
  }, []);

  return { busy, enabled, error, setPush };
}

/**
 * Tells the server while Nakama is on screen here, so a reply that lands while
 * the user is looking at it does not also buzz their phone.
 */
export function usePushPresence(): void {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const clientId = crypto.randomUUID();
    let lastVisible: boolean | null = null;

    const report = (visible: boolean) => {
      lastVisible = visible;
      client.setPushPresence(clientId, visible).catch(() => {
        // Presence is best effort: a miss only means one extra or one missing push.
      });
    };

    const sync = () => {
      const visible =
        document.visibilityState === "visible" && document.hasFocus();

      if (visible !== lastVisible) {
        report(visible);
      }
    };

    // Focus moving into an iframe (an artifact) blurs the window first.
    let blurTimer: ReturnType<typeof setTimeout> | undefined;

    const syncAfterBlur = () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(sync, 0);
    };

    const leave = () => report(false);

    const heartbeat = setInterval(() => {
      if (lastVisible) {
        report(true);
      }
    }, PRESENCE_INTERVAL_MS);

    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", syncAfterBlur);
    window.addEventListener("pagehide", leave);

    return () => {
      clearInterval(heartbeat);
      clearTimeout(blurTimer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", syncAfterBlur);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [isAuthenticated]);
}
