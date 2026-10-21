import { afterEach, expect, spyOn, test } from "bun:test";
import type { McpServerSummary, ProfileDetail } from "@nakama/core/contract";
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
import { client } from "@/lib/client";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

// SAFETY: opening the + menu reads only activeOrg and user from the auth context.
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

async function renderComposer() {
  const noServers: McpServerSummary[] = [];
  const noTools: ProfileDetail["tools"] = [];

  // SAFETY: the + menu reads only `mcpServers` and `tools` from the profile.
  const profile = {
    id: "agent-a",
    mcpServers: noServers,
    tools: noTools,
  } as ProfileDetail;

  const spies = [
    spyOn(client, "listOrgPlugins").mockResolvedValue({ plugins: [] }),
    spyOn(client, "listTools").mockResolvedValue({ tools: [] }),
    spyOn(client, "listSkills").mockResolvedValue({ skills: [] }),
    spyOn(client, "getProfile").mockResolvedValue({ profile }),
  ];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    for (const spy of spies) {
      spy.mockRestore();
    }

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

  const textarea = container.querySelector("textarea");

  if (!textarea) {
    throw new Error("composer textarea not rendered");
  }

  return { container, textarea };
}

async function chooseSlashCommands(container: HTMLElement) {
  await act(async () =>
    container
      .querySelector<HTMLElement>('button[aria-label="Add attachment"]')
      ?.click()
  );
  await waitFor(() =>
    Boolean(findByText('[role="menuitem"]', "Slash commands"))
  );
  await act(async () =>
    findByText('[role="menuitem"]', "Slash commands")?.click()
  );
  await waitFor(() => !findByText('[role="menuitem"]', "Slash commands"));
}

test("Slash commands types / in an empty composer, opens the list and focuses it", async () => {
  const { container, textarea } = await renderComposer();

  await chooseSlashCommands(container);

  expect(textarea.value).toBe("/");
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
    "/add-plugin"
  );
  await waitFor(() => document.activeElement === textarea);
  expect(document.activeElement).toBe(textarea);
});

test("Slash commands keeps the text and adds a space before /", async () => {
  const { container, textarea } = await renderComposer();

  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  await act(async () => {
    setValue?.call(textarea, "hello");
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });

  await chooseSlashCommands(container);

  expect(textarea.value).toBe("hello /");
  expect(textarea.selectionStart).toBe("hello /".length);
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
    "/add-plugin"
  );
});
