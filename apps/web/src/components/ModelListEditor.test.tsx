import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModelListEditor, type ModelListRow } from "./ModelListEditor";

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
