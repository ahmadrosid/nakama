import { afterEach, expect, spyOn, test } from "bun:test";
import type { ComposioSettingsResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ComposioSettingsCard } from "@/components/ComposioSettingsCard";
import { client } from "@/lib/client";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function waitFor(check: () => boolean) {
  for (let tries = 0; tries < 50 && !check(); tries++) {
    await act(() => Bun.sleep(10));
  }
}

const SAVED: ComposioSettingsResponse = {
  apiKeyMasked: null,
  composioReachable: true,
  configured: true,
  savedAvailable: true,
  source: "settings",
};

async function renderCard(settings: ComposioSettingsResponse) {
  const spies = [
    spyOn(client, "getComposioSettings").mockResolvedValue(settings),
    spyOn(client, "listComposioToolkits").mockResolvedValue({
      catalog: [],
      catalogError: null,
      composioAvailable: true,
      composioReachable: true,
      configured: true,
      orgToolkits: [],
      userConnections: [],
    }),
  ];

  const manage = spyOn(client, "manageSettingSecret").mockResolvedValue(
    // SAFETY: the card ignores the response body and refetches settings.
    {} as Awaited<ReturnType<typeof client.manageSettingSecret>>
  );

  const setSecret = spyOn(client, "setComposioSecret").mockResolvedValue(
    settings
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    for (const spy of [...spies, manage, setSecret]) {
      spy.mockRestore();
    }

    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ComposioSettingsCard />
      </QueryClientProvider>
    );
  });

  await waitFor(() => !container.querySelector("[aria-busy]"));

  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === label
    );

  const click = async (label: string) => {
    const target = button(label);
    expect(target).toBeDefined();
    await act(async () => target?.click());
    await act(() => Bun.sleep(0));
  };

  return { button, click, container, manage, setSecret };
}

test("removing a saved key waits for the confirm", async () => {
  const card = await renderCard(SAVED);

  await card.click("Remove");
  expect(card.manage).not.toHaveBeenCalled();

  await card.click("Remove key");
  await waitFor(() => card.manage.mock.calls.length > 0);
  expect(card.manage).toHaveBeenCalledWith("composio", "clear");
});

test("replace saves the new key and returns to the key row", async () => {
  const card = await renderCard(SAVED);

  await card.click("Replace");

  const input =
    card.container.querySelector<HTMLInputElement>("#composio-api-key");

  expect(input).not.toBeNull();

  await act(async () => {
    // React tracks the value on the element's prototype, so set it there.
    const setValue = input
      ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")
          ?.set
      : undefined;

    setValue?.call(input, "  new-project-key  ");

    const view = input?.ownerDocument.defaultView;

    if (input && view) {
      input.dispatchEvent(new view.Event("input", { bubbles: true }));
    }
  });

  await card.click("Save key");
  await waitFor(() => card.button("Replace") !== undefined);

  expect(card.setSecret).toHaveBeenCalledWith("new-project-key");
  expect(card.button("Replace")).toBeDefined();
  expect(card.container.querySelector("#composio-api-key")).toBeNull();
});

test("a key set on the server offers no actions", async () => {
  const card = await renderCard({ ...SAVED, source: "environment" });

  expect(card.container.textContent).toContain("COMPOSIO_API_KEY");
  expect(card.container.querySelectorAll("button")).toHaveLength(0);
});
