import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  notifyReplyReady,
  pageHidesNow,
  REPLY_READY_AWAY,
  readMissedReply,
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
