import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/context/theme-context";
import { ThemeToggle } from "./ThemeToggle";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function renderToggle() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () =>
    root.render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    )
  );

  const tile = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === label
    );

  const pressed = () =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].flatMap(
      (button) =>
        button.getAttribute("aria-pressed") === "true"
          ? [button.textContent?.trim()]
          : []
    );

  return { pressed, tile };
}

test("picking a theme tile selects it and only it", async () => {
  const toggle = await renderToggle();
  expect(toggle.pressed()).toHaveLength(1);

  await act(async () => toggle.tile("Dark")?.click());
  expect(toggle.pressed()).toEqual(["Dark"]);

  await act(async () => toggle.tile("Light")?.click());
  expect(toggle.pressed()).toEqual(["Light"]);
});
