import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ImageGeneration } from "./ImageGeneration";

async function renderText(
  props: Parameters<typeof ImageGeneration>[0]
): Promise<string> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ImageGeneration {...props} />));
    return container.textContent ?? "";
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

test("a finished generation waiting on its preview does not claim to be generating", async () => {
  const text = await renderText({ done: true, prompt: "a cat" });
  expect(text).toContain("Generated image");
  expect(text).not.toContain("Generating image");
});

test("a running generation shows its progress label", async () => {
  expect(await renderText({ prompt: "a cat" })).toContain("Generating image");
});
