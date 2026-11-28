import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OpenRouterModelsBrowseList } from "@/components/OpenRouterModelsBrowseList";
import { client } from "@/lib/client";

let root: Root | null = null;

const cleanups: Array<() => void> = [];

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;

  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

test("the list opens on text models and hides speech and video", async () => {
  const catalog = spyOn(client, "getExternalModelCatalog").mockResolvedValue({
    data: [
      {
        architecture: { output_modalities: ["text"] },
        id: "a/chat",
        name: "Chat",
      },
      {
        architecture: { output_modalities: ["speech"] },
        id: "a/tts",
        name: "TTS",
      },
      {
        architecture: { output_modalities: ["video"] },
        id: "a/video",
        name: "Video",
      },
    ],
  });

  cleanups.push(() => catalog.mockRestore());

  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <OpenRouterModelsBrowseList onSelect={() => undefined} />
      </QueryClientProvider>
    )
  );
  await act(async () => await new Promise((resolve) => setTimeout(resolve)));

  expect(catalog).toHaveBeenCalledWith("openrouter");
  expect(container.textContent).toContain("a/chat");
  expect(container.textContent).not.toContain("a/tts");
  expect(container.textContent).not.toContain("a/video");
});
