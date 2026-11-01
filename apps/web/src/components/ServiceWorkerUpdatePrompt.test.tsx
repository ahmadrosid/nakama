import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ReleaseNote } from "@/lib/release-notes";

const applyUpdate = mock(() => undefined);

const update: { note: ReleaseNote | null } = { note: null };

mock.module("@/hooks/use-service-worker-update", () => ({
  useServiceWorkerUpdate: () => ({
    applyUpdate,
    note: update.note,
    updateReady: true,
    version: "0.4.68",
  }),
}));

const { ServiceWorkerUpdatePrompt } = await import(
  "./ServiceWorkerUpdatePrompt"
);

const previousSessionStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage"
);

let root: Root | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: window.sessionStorage,
    writable: true,
  });
  sessionStorage.clear();
  applyUpdate.mockClear();
  update.note = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";

  if (previousSessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", previousSessionStorage);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<ServiceWorkerUpdatePrompt />));

  return container;
}

function button(container: HTMLElement, name: string) {
  const match = [...container.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name
  );

  if (!match) {
    throw new Error(`No ${name} button`);
  }

  return match;
}

test("shows the new version", () => {
  const container = render();

  expect(container.textContent).toContain("0.4.68");
});

test("Later hides the prompt for the rest of the session", () => {
  const container = render();

  act(() => button(container, "Later").click());

  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(applyUpdate).not.toHaveBeenCalled();

  act(() => root?.unmount());
  root = null;

  expect(render().querySelector('[role="status"]')).toBeNull();
});

test("Reload applies the update", () => {
  const container = render();

  act(() => button(container, "Reload").click());

  expect(applyUpdate).toHaveBeenCalledTimes(1);
});

test("shows at most three change lines", () => {
  update.note = {
    changes: ["one", "two", "three", "four"].map((text) => ({
      kind: "new",
      text,
    })),
    version: "0.4.68",
  };

  const items = [...render().querySelectorAll("li")].map(
    (item) => item.textContent
  );

  expect(items).toHaveLength(3);
  expect(items.join(" ")).not.toContain("four");
});

test("a critical build shows its reason and offers no Later", () => {
  sessionStorage.setItem("nakama-update-later", "1");
  update.note = {
    changes: [{ kind: "fixed", text: "hidden" }],
    critical: "Closes a sign-in hole.",
    version: "0.4.68",
  };

  const container = render();

  expect(container.textContent).toContain("Closes a sign-in hole.");
  expect(container.textContent).not.toContain("hidden");
  expect(() => button(container, "Later")).toThrow();
  expect(button(container, "Reload")).toBeTruthy();
});
