import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppContext, type AppContextValue } from "@/context/app-context-shared";
import { queryKeys } from "@/lib/query-keys";
import type { ReleaseNote } from "@/lib/release-notes";
import { WhatsNewCard } from "./WhatsNew";

const SEEN_KEY = "nakama-whats-new-seen";

const notes: ReleaseNote[] = [
  { changes: [{ kind: "new", text: "Later button" }], version: "0.4.68" },
];

const previousLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);

let root: Root | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
    writable: true,
  });
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

function render(version: string) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.releaseNotes, notes);

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider
          value={
            /* SAFETY: The card reads only health.version. */
            { health: { version } } as AppContextValue
          }
        >
          <WhatsNewCard />
        </AppContext.Provider>
      </QueryClientProvider>
    )
  );

  return container;
}

test("a first visit shows nothing and remembers the version", () => {
  const container = render("0.4.68");

  expect(container.textContent).toBe("");
  expect(localStorage.getItem(SEEN_KEY)).toBe("0.4.68");
});

test("after an update it shows the notes one time", () => {
  localStorage.setItem(SEEN_KEY, "0.4.67");

  const container = render("0.4.68");

  expect(container.textContent).toContain("Later button");

  const gotIt = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Got it"
  );

  act(() => gotIt?.click());

  expect(container.textContent).toBe("");
  expect(localStorage.getItem(SEEN_KEY)).toBe("0.4.68");
});

test("a version without notes shows nothing and is marked seen", () => {
  localStorage.setItem(SEEN_KEY, "0.4.68");

  const container = render("0.4.69");

  expect(container.textContent).toBe("");
  expect(localStorage.getItem(SEEN_KEY)).toBe("0.4.69");
});
