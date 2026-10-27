import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ALL_ATTACHMENT_ACCEPT } from "@/lib/chat-images";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

// SAFETY: opening the + menu and focusing the composer read only activeOrg and user from the auth context.
const auth = {
  activeOrg: {
    createdAt: "",
    id: "org-a",
    name: "A",
    role: "admin",
    slug: "a",
    updatedAt: "",
  },
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
} as AuthContextValue;

async function waitFor(check: () => boolean) {
  for (let tries = 0; tries < 50 && !check(); tries++) {
    await act(() => Bun.sleep(10));
  }
}

function findByText(selector: string, text: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((node) =>
    node.textContent?.includes(text)
  );
}

function renderComposer() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  return { container, root };
}

async function mount(
  container: HTMLDivElement,
  root: ReturnType<typeof createRoot>,
  disabled: boolean
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AuthContext.Provider value={auth}>
            <PromptInputProvider>
              <ChatComposer
                busy={false}
                canStop={false}
                chatStatus="ready"
                currentModelSelection={null}
                disabled={disabled}
                error={null}
                onModelChange={() => undefined}
                onSubmit={() => undefined}
                profileId="agent-a"
                providerModelGroups={[]}
                renderModelLabel={() => null}
              />
            </PromptInputProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  return container.querySelector<HTMLTextAreaElement>("textarea");
}

test("the + menu shows one 'Add files or photos' item instead of separate Image and Document items", async () => {
  const { container, root } = renderComposer();
  await mount(container, root, false);

  const trigger = container.querySelector<HTMLElement>(
    'button[aria-label="Add attachment"]'
  );

  await act(async () => trigger?.click());
  await waitFor(() =>
    Boolean(findByText('[role="menuitem"]', "Add files or photos"))
  );

  expect(findByText('[role="menuitem"]', "Add files or photos")).toBeDefined();
  expect(findByText('[role="menuitem"]', "Image")).toBeUndefined();
  expect(findByText('[role="menuitem"]', "Document")).toBeUndefined();
});

test("clicking 'Add files or photos' opens the picker accepting both images and documents", async () => {
  const { container, root } = renderComposer();
  await mount(container, root, false);

  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');

  if (!fileInput) {
    throw new Error("Expected the hidden attachment file input to render.");
  }

  const clickSpy = spyOn(fileInput, "click");

  const trigger = container.querySelector<HTMLElement>(
    'button[aria-label="Add attachment"]'
  );

  await act(async () => trigger?.click());
  await waitFor(() =>
    Boolean(findByText('[role="menuitem"]', "Add files or photos"))
  );
  await act(async () =>
    findByText('[role="menuitem"]', "Add files or photos")?.click()
  );

  expect(fileInput.accept).toBe(ALL_ATTACHMENT_ACCEPT);
  expect(clickSpy).toHaveBeenCalled();
});

test("Ctrl+U opens the attachment picker while the composer has focus", async () => {
  const { container, root } = renderComposer();
  const textarea = await mount(container, root, false);

  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');

  if (!fileInput) {
    throw new Error("Expected the hidden attachment file input to render.");
  }

  const clickSpy = spyOn(fileInput, "click");

  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "u",
  });

  await act(async () => {
    textarea?.dispatchEvent(event);
  });

  expect(event.defaultPrevented).toBe(true);
  expect(fileInput.accept).toBe(ALL_ATTACHMENT_ACCEPT);
  expect(clickSpy).toHaveBeenCalled();
});

test("Ctrl+U does nothing when the composer is disabled", async () => {
  const { container, root } = renderComposer();
  const textarea = await mount(container, root, true);

  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');

  if (!fileInput) {
    throw new Error("Expected the hidden attachment file input to render.");
  }

  const clickSpy = spyOn(fileInput, "click");

  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "u",
  });

  await act(async () => {
    textarea?.dispatchEvent(event);
  });

  expect(event.defaultPrevented).toBe(false);
  expect(clickSpy).not.toHaveBeenCalled();
});
