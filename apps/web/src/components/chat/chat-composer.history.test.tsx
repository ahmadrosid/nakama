import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

// SAFETY: this composer reads only activeOrg and user from the auth context.
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

const setTextareaValue = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype,
  "value"
)?.set;

async function renderComposer(
  onSubmit: (text: string) => void,
  promptHistoryRef?: RefObject<string[]>
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

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
                error={null}
                onModelChange={() => undefined}
                onSubmit={(text) => onSubmit(text)}
                profileId="agent-a"
                promptHistoryRef={promptHistoryRef}
                providerModelGroups={[]}
                renderModelLabel={() => null}
              />
            </PromptInputProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const textarea = container.querySelector("textarea");

  if (!textarea) {
    throw new Error("composer textarea not rendered");
  }

  return { container, root, textarea };
}

async function typeText(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {
    setTextareaValue?.call(textarea, text);
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function submit(container: HTMLElement, textarea: HTMLTextAreaElement) {
  await typeText(textarea, textarea.value);

  const sendButton = container.querySelector<HTMLElement>(
    'button[aria-label="Send message"]'
  );

  await act(async () => sendButton?.click());
}

function caretUp(textarea: HTMLTextAreaElement) {
  textarea.setSelectionRange(0, 0);

  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "ArrowUp",
  });

  textarea.dispatchEvent(event);

  return event;
}

function caretDown(textarea: HTMLTextAreaElement) {
  textarea.setSelectionRange(0, 0);

  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "ArrowDown",
  });

  textarea.dispatchEvent(event);

  return event;
}

test("ArrowUp recalls the most recently sent prompt", async () => {
  const sent: string[] = [];

  const { container, textarea } = await renderComposer((text) =>
    sent.push(text)
  );

  await typeText(textarea, "hello");
  await submit(container, textarea);

  expect(textarea.value).toBe("");

  let event: KeyboardEvent | undefined;
  await act(async () => {
    event = caretUp(textarea);
  });

  expect(event?.defaultPrevented).toBe(true);
  expect(textarea.value).toBe("hello");
  expect(sent).toEqual(["hello"]);
});

test("ArrowUp steps further back through older prompts, clamped at the oldest", async () => {
  const { container, textarea } = await renderComposer(() => undefined);

  await typeText(textarea, "first");
  await submit(container, textarea);
  await typeText(textarea, "second");
  await submit(container, textarea);

  await act(async () => caretUp(textarea));
  expect(textarea.value).toBe("second");

  await act(async () => caretUp(textarea));
  expect(textarea.value).toBe("first");

  // Already at the oldest entry: stays put instead of indexing out of bounds.
  await act(async () => caretUp(textarea));
  expect(textarea.value).toBe("first");
});

test("ArrowDown moves forward and clears the input after the newest entry", async () => {
  const { container, textarea } = await renderComposer(() => undefined);

  await typeText(textarea, "first");
  await submit(container, textarea);
  await typeText(textarea, "second");
  await submit(container, textarea);

  await act(async () => caretUp(textarea));
  await act(async () => caretUp(textarea));
  expect(textarea.value).toBe("first");

  await act(async () => caretDown(textarea));
  expect(textarea.value).toBe("second");

  await act(async () => caretDown(textarea));
  expect(textarea.value).toBe("");
});

test("ArrowDown does nothing when not browsing history", async () => {
  const { textarea } = await renderComposer(() => undefined);

  let event: KeyboardEvent | undefined;
  await act(async () => {
    event = caretDown(textarea);
  });

  expect(event?.defaultPrevented).toBe(false);
  expect(textarea.value).toBe("");
});

test("ArrowUp does nothing when the cursor is not at the start of the text", async () => {
  const { container, textarea } = await renderComposer(() => undefined);

  await typeText(textarea, "first");
  await submit(container, textarea);
  await typeText(textarea, "draft");
  await act(() => {
    textarea.setSelectionRange(5, 5);
  });

  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "ArrowUp",
  });

  await act(async () => textarea.dispatchEvent(event));

  expect(event.defaultPrevented).toBe(false);
  expect(textarea.value).toBe("draft");
});

test("typing while browsing history resets the pointer back to the newest entry", async () => {
  const { container, textarea } = await renderComposer(() => undefined);

  await typeText(textarea, "first");
  await submit(container, textarea);
  await typeText(textarea, "second");
  await submit(container, textarea);

  await act(async () => caretUp(textarea));
  await act(async () => caretUp(textarea));
  expect(textarea.value).toBe("first");

  await typeText(textarea, "editing");
  await act(async () => caretUp(textarea));

  expect(textarea.value).toBe("second");
});

test("history survives the composer remounting, when the caller owns the ref", async () => {
  // Mirrors the real app: the first send in a new chat changes `session`
  // from null to a real id, which changes `PromptInputProvider`'s key and
  // remounts ChatComposer. A ref owned one level up (use-chat-page.ts)
  // outlives that remount; an internal `useRef` inside ChatComposer would not.
  const promptHistoryRef: RefObject<string[]> = { current: [] };

  const first = await renderComposer(() => undefined, promptHistoryRef);
  await typeText(first.textarea, "hello from the first chat");
  await submit(first.container, first.textarea);

  await act(async () => first.root.unmount());
  first.container.remove();

  const second = await renderComposer(() => undefined, promptHistoryRef);

  let event: KeyboardEvent | undefined;
  await act(async () => {
    event = caretUp(second.textarea);
  });

  expect(event?.defaultPrevented).toBe(true);
  expect(second.textarea.value).toBe("hello from the first chat");
});
