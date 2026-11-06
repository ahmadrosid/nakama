import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  type SettingsModelOption,
  SettingsModelSelect,
} from "./settings-model-select";

const openai = { id: "p-openai", label: "OpenAI" };
const local = { id: "p-local", label: "Local" };

const options: SettingsModelOption[] = [
  { label: "None", value: "none" },
  { label: "A · OpenAI", name: "A", provider: openai, value: "p-openai::a" },
  { label: "B · OpenAI", name: "B", provider: openai, value: "p-openai::b" },
  { label: "C · Local", name: "C", provider: local, value: "p-local::c" },
];

let container: HTMLDivElement;

let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(onValueChange: (value: string) => void) {
  await act(async () =>
    root.render(
      <SettingsModelSelect
        ariaLabel="Image parsing model"
        onValueChange={onValueChange}
        options={options}
        triggerLabel="None"
        value="none"
      />
    )
  );
}

const trigger = (label: string) =>
  container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);

async function pick(triggerLabel: string, itemLabel: string) {
  await act(async () => {
    trigger(triggerLabel)?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const item = [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
    (element) => element.textContent === itemLabel
  );

  await act(async () => item?.click());
}

test("a provider with several models saves only after a model is picked", async () => {
  const onValueChange = mock((_value: string) => {});
  await render(onValueChange);

  expect(trigger("Image parsing model model")?.disabled).toBe(true);

  await pick("Image parsing model provider", "OpenAI");
  expect(onValueChange).not.toHaveBeenCalled();
  expect(trigger("Image parsing model model")?.disabled).toBe(false);

  await pick("Image parsing model model", "B");
  expect(onValueChange).toHaveBeenCalledWith("p-openai::b");
});

test("a provider with one model saves it at once", async () => {
  const onValueChange = mock((_value: string) => {});
  await render(onValueChange);

  await pick("Image parsing model provider", "Local");
  expect(onValueChange).toHaveBeenCalledWith("p-local::c");
});
