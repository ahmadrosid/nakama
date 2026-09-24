import { expect, spyOn, test } from "bun:test";
import type { WebSearchSettingsResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const { createRoot } = await import("react-dom/client");
const { WebSearchSettingsCard } = await import("./WebSearchSettingsCard");
const initial: WebSearchSettingsResponse = {
  apiKeyMasked: "old-key",
  configured: true,
  endpoint: null,
  provider: "exa",
};
const builtIn: WebSearchSettingsResponse = {
  apiKeyMasked: null,
  configured: false,
  endpoint: null,
  provider: null,
};

async function mountCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(queryKeys.webSearchSettings, initial);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <WebSearchSettingsCard />
      </QueryClientProvider>
    );
  });
  return {
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
      queryClient.clear();
    },
    async refresh(settings: WebSearchSettingsResponse) {
      await act(async () => {
        queryClient.setQueryData(queryKeys.webSearchSettings, settings);
        await Bun.sleep(10);
      });
    },
    async remount() {
      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>
            <WebSearchSettingsCard key="remounted" />
          </QueryClientProvider>
        );
      });
    },
  };
}

function input() {
  const element = document.querySelector<HTMLInputElement>(
    "#web-search-api-key"
  );
  if (!element) {
    throw new Error("Missing API key input");
  }
  return element;
}

function button(selector: string) {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) {
    throw new Error(`Missing button: ${selector}`);
  }
  return element;
}

async function typeKey(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set?.call(input(), value);
    input().dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function selectProvider(label: string) {
  await act(async () => button("#web-search-provider").click());
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((element) => element.textContent?.includes(label));
  if (!option) {
    throw new Error(`Missing provider: ${label}`);
  }
  await act(async () => option.click());
}

async function settle() {
  await act(async () => {
    await Bun.sleep(10);
  });
}

test("changed background settings preserve the key and its provider; identical refresh is a control", async () => {
  const card = await mountCard();
  try {
    const field = input();
    await typeKey("unsaved-key");
    await act(async () => button('[aria-label="Show API key"]').click());
    await card.refresh({ ...initial });
    expect(input()).toBe(field);
    expect(input().value).toBe("unsaved-key");
    await card.refresh({ ...initial, apiKeyMasked: "rotated-key" });
    expect(input()).toBe(field);
    expect(input().value).toBe("unsaved-key");
    await card.refresh({ ...initial, provider: "firecrawl" });
    expect(button("#web-search-provider").textContent?.toLowerCase()).toContain(
      "exa"
    );
    expect(input().value).toBe("unsaved-key");
    expect(input().placeholder).toBe("Paste API key");
  } finally {
    await card.cleanup();
  }
});

test("a provider-only draft survives refresh, while a pristine form follows the server", async () => {
  const card = await mountCard();
  try {
    await card.refresh(builtIn);
    expect(document.querySelector("#web-search-api-key")).toBeNull();
    await selectProvider("Firecrawl");
    await card.refresh(initial);
    expect(button("#web-search-provider").textContent?.toLowerCase()).toContain(
      "firecrawl"
    );
    expect(input().value).toBe("");
    expect(button("#btn-web-search-save").disabled).toBe(true);
  } finally {
    await card.cleanup();
  }
});

test("save blocks edits, preserves the draft on failure, and clears it after retry success", async () => {
  const request = Promise.withResolvers<WebSearchSettingsResponse>();
  const save = spyOn(client, "setWebSearchSettings").mockReturnValueOnce(
    request.promise
  );
  const card = await mountCard();
  try {
    await typeKey("  replacement-key  ");
    await act(async () => button("#btn-web-search-save").click());
    await settle();
    expect(save).toHaveBeenCalledWith({
      apiKey: "replacement-key",
      provider: "exa",
    });
    expect(input().disabled).toBe(true);
    expect(button("#web-search-provider").disabled).toBe(true);
    expect(button("#btn-web-search-save").disabled).toBe(true);
    await card.refresh({ ...initial, apiKeyMasked: "concurrent-key" });
    await act(async () => request.reject(new Error("Save failed")));
    await settle();
    expect(input().value).toBe("  replacement-key  ");
    expect(input().disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    // An identical response must clear the draft too: success, not cache identity, owns reset.
    save.mockResolvedValue({ ...initial, apiKeyMasked: "concurrent-key" });
    await act(async () => button("#btn-web-search-save").click());
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(input().value).toBe("");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    await card.refresh(builtIn);
    expect(document.querySelector("#web-search-api-key")).toBeNull();
  } finally {
    save.mockRestore();
    await card.cleanup();
  }
});

test("built-in selection saves immediately and a failed selection can be retried", async () => {
  const save = spyOn(client, "setWebSearchSettings")
    .mockRejectedValueOnce(new Error("Save failed"))
    .mockResolvedValue(builtIn);
  const card = await mountCard();
  try {
    await typeKey("discard-on-provider-change");
    await selectProvider("Built-in");
    await settle();
    expect(save).toHaveBeenCalledWith({ provider: null });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await selectProvider("Exa");
    expect(input().value).toBe("");
    await selectProvider("Built-in");
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#web-search-api-key")).toBeNull();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    await card.refresh(initial);
    expect(input().placeholder).toBe("Saved (old-key)");
  } finally {
    save.mockRestore();
    await card.cleanup();
  }
});

test("a departed form's save cannot clear a new form's draft", async () => {
  const request = Promise.withResolvers<WebSearchSettingsResponse>();
  const save = spyOn(client, "setWebSearchSettings").mockReturnValue(
    request.promise
  );
  const card = await mountCard();
  try {
    await typeKey("departed-key");
    await act(async () => button("#btn-web-search-save").click());
    await settle();
    await card.remount();
    expect(input().value).toBe("");
    await typeKey("new-draft");
    await act(async () =>
      request.resolve({ ...initial, apiKeyMasked: "departed-mask" })
    );
    await settle();
    expect(input().value).toBe("new-draft");
    expect(input().placeholder).toBe("Saved (departed-mask)");
    expect(document.querySelector('[role="status"]')).toBeNull();
  } finally {
    save.mockRestore();
    await card.cleanup();
  }
});
