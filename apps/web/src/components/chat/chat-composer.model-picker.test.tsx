import { afterEach, expect, test } from "bun:test";
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
import { encodeModelSelection } from "@/lib/models";

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

const groups = [
  {
    models: [
      { id: "model-first", name: "First", provider: "openai" as const },
      { id: "model-second", name: "Second", provider: "openai" as const },
    ],
    providerId: "provider-a",
    providerLabel: "Provider A",
  },
];

async function openPicker(
  currentModelSelection: string,
  providerModelGroups: typeof groups = groups
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
                currentModelSelection={currentModelSelection}
                error={null}
                onModelChange={() => undefined}
                onSubmit={() => undefined}
                profileId="agent-a"
                providerConfigured
                providerModelGroups={providerModelGroups}
                renderModelLabel={() => "Second"}
              />
            </PromptInputProvider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const trigger = container.querySelector<HTMLElement>(
    'button[aria-label="Select model and effort"]'
  );

  await act(async () => trigger?.click());

  return trigger;
}

test("the model picker opens with the model in use selected", async () => {
  await openPicker(encodeModelSelection("provider-a", "model-second"));

  const selected = [
    ...document.querySelectorAll('[cmdk-item][aria-selected="true"]'),
  ].map((item) => item.textContent?.trim());

  expect(selected).toEqual(["Second"]);
});

test("the chip names the provider when two providers share a model name", async () => {
  const shared = [
    ...groups,
    {
      models: [
        { id: "model-second", name: "Second", provider: "openai" as const },
      ],
      providerId: "provider-b",
      providerLabel: "Provider B",
    },
  ];

  const trigger = await openPicker(
    encodeModelSelection("provider-b", "model-second"),
    shared
  );

  expect(trigger?.textContent).toContain("Provider B");
});
