import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SetupAuthRequest } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AppContext } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { SetupWizard } from "./SetupWizard";

const DRAFT_KEY = "nakama:setup-account-draft";

const previousSessionStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage"
);

let container: HTMLDivElement;

let root: Root | null = null;

beforeEach(() => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: window.sessionStorage,
    writable: true,
  });
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";

  if (previousSessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", previousSessionStorage);
  } else {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

async function renderWizard(
  setup: (request: SetupAuthRequest) => Promise<void> = () => Promise.resolve()
) {
  await act(async () => root?.unmount());
  root = createRoot(container);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });

  await act(async () =>
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthContext.Provider
            value={
              /* SAFETY: The wizard steps read only setup from auth. */
              { setup } as AuthContextValue
            }
          >
            <AppContext.Provider
              value={
                /* SAFETY: The wizard reads only health from the app context. */
                { health: { userConfigured: false } } as never
              }
            >
              <SetupWizard onComplete={() => undefined} />
            </AppContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  );
}

function input(id: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);

  if (!element) {
    throw new Error(`Missing input #${id}`);
  }

  return element;
}

async function typeInto(id: string, value: string) {
  const element = input(id);

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set?.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function submit(id: string) {
  await act(async () => input(id).closest("form")?.requestSubmit());
}

async function completeAccountStep() {
  await typeInto("setup-name", "Jane Admin");
  await typeInto("setup-email", "admin@example.com");
  await typeInto("setup-phone", "+628123456789");
  await typeInto("setup-password", "correct-horse");
  await typeInto("setup-confirm", "correct-horse");
  await submit("setup-name");
}

async function completeOrganizationStep() {
  await typeInto("setup-org-name", "Acme");
  await submit("setup-org-name");
}

test("stores name, email and phone from step 1 without the password", async () => {
  await renderWizard();
  await completeAccountStep();

  const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");

  expect(stored).toEqual({
    email: "admin@example.com",
    name: "Jane Admin",
    phone: "+628123456789",
  });
  expect(stored).not.toHaveProperty("password");
});

test("a reload on step 2 returns to step 1 with the fields filled except passwords", async () => {
  await renderWizard();
  await completeAccountStep();
  expect(container.querySelector("#setup-org-name")).not.toBeNull();

  await renderWizard();

  expect(input("setup-name").value).toBe("Jane Admin");
  expect(input("setup-email").value).toBe("admin@example.com");
  expect(input("setup-phone").value).toBe("+628123456789");
  expect(input("setup-password").value).toBe("");
  expect(input("setup-confirm").value).toBe("");
});

test("a broken stored draft starts step 1 empty", async () => {
  sessionStorage.setItem(DRAFT_KEY, "{not json");
  await renderWizard();
  expect(input("setup-name").value).toBe("");

  sessionStorage.setItem(DRAFT_KEY, "null");
  await renderWizard();
  expect(input("setup-name").value).toBe("");

  await completeAccountStep();

  expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null")).toEqual({
    email: "admin@example.com",
    name: "Jane Admin",
    phone: "+628123456789",
  });
});

test("stores and restores an empty phone as an empty string", async () => {
  await renderWizard();
  await typeInto("setup-name", "Jane Admin");
  await typeInto("setup-email", "admin@example.com");
  await typeInto("setup-password", "correct-horse");
  await typeInto("setup-confirm", "correct-horse");
  await submit("setup-name");

  expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null")).toEqual({
    email: "admin@example.com",
    name: "Jane Admin",
    phone: "",
  });

  await renderWizard();

  expect(input("setup-name").value).toBe("Jane Admin");
  expect(input("setup-phone").value).toBe("");
});

test("moves to step 2 when the draft cannot be saved", async () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    },
    writable: true,
  });
  await renderWizard();
  await completeAccountStep();

  expect(container.querySelector("#setup-org-name")).not.toBeNull();
});

test("clears the stored draft once setup succeeds", async () => {
  const requests: SetupAuthRequest[] = [];

  await renderWizard((request) => {
    requests.push(request);

    return Promise.resolve();
  });
  await completeAccountStep();
  expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
  await completeOrganizationStep();

  expect(requests).toHaveLength(1);
  expect(requests[0]?.admin.password).toBe("correct-horse");
  expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
});

test("keeps the stored draft when setup fails", async () => {
  await renderWizard(() => Promise.reject(new Error("Setup failed")));
  await completeAccountStep();
  await completeOrganizationStep();

  expect(container.querySelector("#setup-org-name")).not.toBeNull();
  expect(sessionStorage.getItem(DRAFT_KEY)).not.toBeNull();
});
