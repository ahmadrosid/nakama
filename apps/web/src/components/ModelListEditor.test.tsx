import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ModelListEditor,
  type ModelListRow,
  ModelUsageContext,
} from "./ModelListEditor";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

test("picking a default marks only that model", async () => {
  let saved: ModelListRow[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <ModelListEditor
        models={[{ id: "a" }, { default: true, id: "b" }]}
        onChange={(rows) => {
          saved = rows;
        }}
      />
    )
  );

  const radios = container.querySelectorAll<HTMLInputElement>(
    'input[type="radio"]'
  );

  expect([...radios].map((radio) => radio.checked)).toEqual([false, true]);

  await act(async () => radios[0]!.click());
  expect(saved.map((row) => row.default)).toEqual([true, false]);
});

test("a long list can be searched", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  const models = Array.from({ length: 11 }, (_, index) => ({
    id: `model-${index}`,
  }));

  await act(async () =>
    root!.render(<ModelListEditor models={models} onChange={() => undefined} />)
  );

  const search = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search saved models"]'
  );

  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    setValue?.call(search, "model-10");
    search?.dispatchEvent(new window.Event("input", { bubbles: true }));
  });

  expect(container.querySelectorAll("li")).toHaveLength(1);
});

test("a model a setting uses is marked", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <ModelUsageContext.Provider value={{ "a/one": ["Image parsing"] }}>
        <ModelListEditor
          models={[{ id: "a/one" }, { id: "a/two" }]}
          onChange={() => undefined}
        />
      </ModelUsageContext.Provider>
    )
  );

  const rows = [...container.querySelectorAll("li")].map((row) =>
    row.textContent?.includes("Image parsing")
  );

  expect(rows).toEqual([true, false]);
});
