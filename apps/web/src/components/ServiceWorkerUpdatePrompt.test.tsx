import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const applyUpdate = mock(() => undefined);

mock.module("@/hooks/use-service-worker-update", () => ({
  useServiceWorkerUpdate: () => ({
    applyUpdate,
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
