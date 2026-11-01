import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ReleaseNote } from "@/lib/release-notes";

const applyUpdate = mock(() => undefined);

let note: ReleaseNote | null = null;

mock.module("@/hooks/use-service-worker-update", () => ({
  useServiceWorkerUpdate: () => ({
    applyUpdate,
    note,
    updateReady: true,
    version: "0.4.68",
  }),
}));

const { ServiceWorkerUpdateNotice, ServiceWorkerUpdateProvider } = await import(
  "./ServiceWorkerUpdatePrompt"
);

let root: Root | null = null;

beforeEach(() => {
  applyUpdate.mockClear();
  note = null;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ServiceWorkerUpdateProvider>
        <ServiceWorkerUpdateNotice />
      </ServiceWorkerUpdateProvider>
    )
  );

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

test("Reload applies the update", () => {
  const container = render();

  act(() => button(container, "Reload").click());

  expect(applyUpdate).toHaveBeenCalledTimes(1);
});

test("What's new shows at most three change lines, on demand", () => {
  note = {
    changes: ["one", "two", "three", "four"].map((text) => ({
      kind: "new",
      text,
    })),
    version: "0.4.68",
  };

  const container = render();
  expect(container.querySelectorAll("li")).toHaveLength(0);

  act(() => button(container, "What's new").click());

  const items = [...container.querySelectorAll("li")].map(
    (item) => item.textContent
  );

  expect(items).toHaveLength(3);
  expect(items.join(" ")).not.toContain("four");
});

test("no notes means no What's new", () => {
  const container = render();

  expect(() => button(container, "What's new")).toThrow();
});

test("a repeated line shows once", () => {
  note = {
    changes: ["same", "same", "other"].map((text) => ({ kind: "new", text })),
    version: "0.4.68",
  };

  const container = render();
  act(() => button(container, "What's new").click());

  expect(container.querySelectorAll("li")).toHaveLength(2);
});

test("a critical build shows its reason with Reload", () => {
  note = {
    changes: [{ kind: "fixed", text: "listed" }],
    critical: "reason",
    version: "0.4.68",
  };

  const container = render();

  expect(container.textContent).toContain("reason");
  expect(button(container, "Reload")).toBeTruthy();
});
