import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";
import { createClientId } from "@/lib/client-id";

/** Fired after this device's subscription changes, so every switch re-reads it. */
const WEB_PUSH_CHANGED = "nakama:web-push-changed";

/** Fired when a reply finishes after the user left Nakama. */
export const REPLY_READY_AWAY = "nakama:reply-ready-away";

/** Kept per tab, so a reload or a discarded tab still shows the offer. */
const MISSED_REPLY_KEY = "nakama.webPushPrompt.missedReply";

/** Nakama is on screen and has focus here. */
function isOnScreen(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Counts each time this page goes hidden. A phone pauses a hidden page, so its
 * reply can end only after the user is back; the count still shows they left.
 */
let pageHides = 0;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pageHides += 1;
    }
  });
}

/** Read when a turn starts; pass it to `notifyReplyReady` when it ends. */
export function pageHidesNow(): number {
  return pageHides;
}

export function readMissedReply(): boolean {
  try {
    return sessionStorage.getItem(MISSED_REPLY_KEY) === "1";
  } catch {
    return false;
  }
}

let resyncedThisPage = false;

/** How often an on-screen page tells the server; the server forgets after 75s. */
const PRESENCE_INTERVAL_MS = 30_000;

/** This browser can hold a Web Push subscription. */
export const browserPushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/**
 * Electron has no push service, so the desktop app shows a local notification
 * from the open page instead. Read from the user agent: the preload's
 * `data-desktop` lands only after the first render.
 */
const isDesktopApp =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Electron/");

/**
 * The reply switch can work here. The desktop app needs only `Notification`:
 * a plain-http server gives it no service worker.
 */
export const webPushSupported = isDesktopApp
  ? typeof window !== "undefined" && "Notification" in window
  : browserPushSupported;

const DESKTOP_NOTIFY_KEY = "nakama.desktopNotify";

function readDesktopNotify(): boolean {
  try {
    return (
      localStorage.getItem(DESKTOP_NOTIFY_KEY) === "1" &&
      Notification.permission === "granted"
    );
  } catch {
    return false;
  }
}

function writeDesktopNotify(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(DESKTOP_NOTIFY_KEY, "1");
    } else {
      localStorage.removeItem(DESKTOP_NOTIFY_KEY);
    }
  } catch {
    // Without storage the switch cannot stay on; it reads off next load.
  }
}

/**
 * A reply ended. When the user left during the turn, this marks the reply as
 * missed for the notification offer. The desktop app also shows a local
 * notification while Nakama is not in front; the browser gets Web Push.
 */
export function notifyReplyReady(message: {
  body: string;
  hidesAtStart: number;
  onOpen: () => void;
  tag: string;
  title: string;
}): void {
  // Hidden only, not unfocused: a window beside another app is still watched.
  if (
    document.visibilityState === "hidden" ||
    pageHides !== message.hidesAtStart
  ) {
    try {
      sessionStorage.setItem(MISSED_REPLY_KEY, "1");
    } catch {
      // Without storage the offer still shows until this page reloads.
    }

    window.dispatchEvent(new Event(REPLY_READY_AWAY));
  }

  if (isOnScreen() || !(isDesktopApp && readDesktopNotify())) {
    return;
  }

  const body = Array.from(message.body.replace(/\s+/g, " ").trim());

  const notification = new Notification(message.title, {
    body:
      body.length > 180
        ? `${body.slice(0, 179).join("")}…`
        : body.join("") || "Reply ready",
    tag: message.tag,
  });

  notification.onclick = () => {
    window.focus();
    message.onOpen();
    notification.close();
  };
}

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
  const applicationServerKey = urlBase64ToBytes(
    await client.getPushPublicKey()
  );

  let subscription: PushSubscription;

  try {
    subscription = await registration.pushManager.subscribe({
      applicationServerKey,
      userVisibleOnly: true,
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError" &&
      (error.message === "Registration failed - push service error" ||
        error.message === "Registration failed - push service not available")
    ) {
      // SAFETY: Brave supplies this optional API. Other browsers lack it.
      const { brave } = navigator as Navigator & {
        brave?: { isBrave: () => Promise<boolean> };
      };

      if (await brave?.isBrave().catch(() => false)) {
        throw new Error(
          "Brave could not start push messaging. In brave://settings/privacy, check that “Use Google services for push messaging” is on. If you turn it on, restart Brave and try again.",
          { cause: error }
        );
      }
    }

    throw error;
  }

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
  const { activeOrg, orgs, platformOrgs, switchOrg } = useAuth();
  const [params, setParams] = useSearchParams();
  const wanted = params.get("org");
  // Set once switchOrg ends either way: it can resolve without a switch when a
  // newer auth change wins, and the chat must not wait for good.
  const [settled, setSettled] = useState<string | null>(null);
  const startedRef = useRef<string | null>(null);

  const switching =
    wanted !== null &&
    wanted !== settled &&
    wanted !== activeOrg?.id &&
    (orgs.some((org) => org.id === wanted) ||
      platformOrgs.some((org) => org.id === wanted && !org.archivedAt));

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
    switchOrg(wanted)
      .catch(() => undefined)
      .finally(() => setSettled(wanted));
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
      if (isDesktopApp) {
        setEnabled(readDesktopNotify());

        return;
      }

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

      if (isDesktopApp) {
        writeDesktopNotify(next);
        setEnabled(next);

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

    const clientId = createClientId();
    let lastVisible: boolean | null = null;

    const report = (visible: boolean) => {
      lastVisible = visible;
      client.setPushPresence(clientId, visible).catch(() => {
        // Presence is best effort: a miss only means one extra or one missing push.
      });
    };

    const sync = () => {
      const visible = isOnScreen();

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
