import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import {
  notifyReplyReady,
  pageHidesNow,
  REPLY_READY_AWAY,
  readMissedReply,
  useWebPush,
} from "./use-web-push";

const previousSessionStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage"
);

const previousEvent = Object.getOwnPropertyDescriptor(globalThis, "Event");

let visibility: DocumentVisibilityState = "visible";

let events = 0;

const countEvent = () => {
  events += 1;
};

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function replyEnds(hidesAtStart: number) {
  notifyReplyReady({
    body: "Done",
    hidesAtStart,
    onOpen: () => undefined,
    tag: "session-1",
    title: "Nakama",
  });
}

beforeEach(() => {
  // The page code builds events with the global Event; happy-dom needs its own.
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: window.Event,
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: window.sessionStorage,
    writable: true,
  });
  sessionStorage.clear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  visibility = "visible";
  events = 0;
  window.addEventListener(REPLY_READY_AWAY, countEvent);
});

afterEach(() => {
  window.removeEventListener(REPLY_READY_AWAY, countEvent);
  Reflect.deleteProperty(document, "visibilityState");

  if (previousEvent) {
    Object.defineProperty(globalThis, "Event", previousEvent);
  }

  if (previousSessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", previousSessionStorage);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("a reply the user stayed for is not a missed reply", () => {
  replyEnds(pageHidesNow());

  expect(events).toBe(0);
  expect(readMissedReply()).toBe(false);
});

test("a reply that ends while the page is hidden is missed", () => {
  const hidesAtStart = pageHidesNow();
  setVisibility("hidden");
  replyEnds(hidesAtStart);

  expect(events).toBe(1);
  expect(readMissedReply()).toBe(true);
});

test("a reply that ends after the user came back is still missed", () => {
  const hidesAtStart = pageHidesNow();
  setVisibility("hidden");
  setVisibility("visible");
  replyEnds(hidesAtStart);

  expect(events).toBe(1);
  expect(readMissedReply()).toBe(true);
});

const pushServiceError = "Registration failed - push service error";

const braveSetting = "Use Google services for push messaging";

test.each([
  { brave: true, expected: braveSetting, message: pushServiceError },
  { brave: false, expected: pushServiceError, message: pushServiceError },
  {
    brave: true,
    expected: "Registration failed - no Service Worker",
    message: "Registration failed - no Service Worker",
  },
])(
  "subscription error guidance matches the failing browser and error",
  async ({ brave, message, expected }) => {
    const subscribe = mock(async () => {
      throw new DOMException(message, "AbortError");
    });

    const publicKey = spyOn(client, "getPushPublicKey").mockResolvedValue("AQ");
    const save = spyOn(client, "savePushSubscription");

    const globals = [
      [navigator, "brave", brave ? { isBrave: async () => true } : undefined],
      [
        navigator,
        "serviceWorker",
        {
          ready: Promise.resolve({
            pushManager: { getSubscription: async () => null, subscribe },
          }),
        },
      ],
      [
        globalThis,
        "Notification",
        { requestPermission: async () => "granted" },
      ],
    ] as const;

    const originals = globals.map(([owner, name]) =>
      Object.getOwnPropertyDescriptor(owner, name)
    );

    const root = createRoot(document.createElement("div"));
    let push!: ReturnType<typeof useWebPush>;

    function Probe() {
      push = useWebPush();

      return null;
    }

    try {
      for (const [owner, name, value] of globals) {
        Object.defineProperty(owner, name, { configurable: true, value });
      }

      await act(async () => root.render(createElement(Probe)));
      await act(async () => push.setPush(true));
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      expect(push.enabled).toBe(false);
      expect(push.error).toContain(expected);
    } finally {
      await act(async () => root.unmount());
      publicKey.mockRestore();
      save.mockRestore();

      for (const [index, [owner, name]] of globals.entries()) {
        const original = originals[index];

        if (original) {
          Object.defineProperty(owner, name, original);
        } else {
          Reflect.deleteProperty(owner, name);
        }
      }
    }
  }
);
