import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { prefetchAppData, useThinkingSettings } from "./use-app-queries";

test("a prefetched setting is not fetched again when its hook mounts", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const getThinkingSettings = spyOn(
    client,
    "getThinkingSettings"
  ).mockResolvedValue({ effort: "medium", enabled: true } as never);
  function Probe() {
    useThinkingSettings();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    prefetchAppData(queryClient);
    await act(async () => {
      await queryClient.prefetchQuery({
        queryFn: () => null,
        queryKey: ["__settle__"],
      });
    });
    expect(getThinkingSettings).toHaveBeenCalledTimes(1);

    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(getThinkingSettings).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    getThinkingSettings.mockRestore();
    queryClient.clear();
  }
});
