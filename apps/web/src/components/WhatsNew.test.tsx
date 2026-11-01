import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { queryKeys } from "@/lib/query-keys";
import type { ReleaseNote } from "@/lib/release-notes";
import { WhatsNewCard, WhatsNewDialog } from "./WhatsNew";

const SEEN_KEY = "nakama-whats-new-seen";

const notes: ReleaseNote[] = [
  { changes: [{ kind: "new", text: "Later button" }], version: "0.4.68" },
  { changes: [{ kind: "fixed", text: "Older fix" }], version: "0.4.67" },
];

const previousLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);

const previousVersion = process.env.VITE_NAKAMA_VERSION;

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

  if (previousVersion === undefined) {
    Reflect.deleteProperty(process.env, "VITE_NAKAMA_VERSION");
  } else {
    process.env.VITE_NAKAMA_VERSION = previousVersion;
  }

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

function render(
  node: ReactNode,
  { seed = true, version = "0.4.68" }: { seed?: boolean; version?: string } = {}
) {
  process.env.VITE_NAKAMA_VERSION = version;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  if (seed) {
    queryClient.setQueryData(queryKeys.releaseNotes, notes);
  }

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() =>
    root?.render(
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    )
  );

  return container;
}

test("a first visit shows nothing and remembers the version", () => {
  const container = render(<WhatsNewCard />);

  expect(container.textContent).toBe("");
  expect(localStorage.getItem(SEEN_KEY)).toBe("0.4.68");
});

test("after an update it shows the notes one time", () => {
  localStorage.setItem(SEEN_KEY, "0.4.67");

  const container = render(<WhatsNewCard />);

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

  const container = render(<WhatsNewCard />, { version: "0.4.69" });

  expect(container.textContent).toBe("");
  expect(localStorage.getItem(SEEN_KEY)).toBe("0.4.69");
});

test("the other prompt shows only when there are no notes to show", () => {
  localStorage.setItem(SEEN_KEY, "0.4.67");

  const container = render(
    <WhatsNewCard>
      <p>Other prompt</p>
    </WhatsNewCard>
  );

  expect(container.textContent).not.toContain("Other prompt");

  const gotIt = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === "Got it"
  );

  act(() => gotIt?.click());

  expect(container.textContent).toBe("Other prompt");
});

test("a failed notes fetch keeps the old version", async () => {
  localStorage.setItem(SEEN_KEY, "0.4.67");

  const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("offline")
  );

  const container = render(<WhatsNewCard />, { seed: false });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.textContent).toBe("");
  expect(localStorage.getItem(SEEN_KEY)).toBe("0.4.67");
  fetchSpy.mockRestore();
});

test("the dialog lists every release", async () => {
  render(<WhatsNewDialog onOpenChange={() => undefined} open />);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(document.body.textContent).toContain("0.4.68");
  expect(document.body.textContent).toContain("Later button");
  expect(document.body.textContent).toContain("0.4.67");
  expect(document.body.textContent).toContain("Older fix");
});
