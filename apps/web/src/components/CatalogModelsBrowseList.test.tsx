import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowsableModelFields } from "./BrowsableModelFields";
import { CatalogModelsBrowseList } from "./CatalogModelsBrowseList";
import type { ModelListRow } from "./ModelListEditor";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

test("a click in a multi-pick list adds the model at once", async () => {
  const added: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <CatalogModelsBrowseList
        multiSelect
        onAddMany={(rows) => added.push(...rows.map((row) => row.id))}
        onSelect={() => undefined}
        rows={[{ id: "a/one", name: "One" }]}
      />
    )
  );

  const row = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("a/one")
  );

  await act(async () => row?.click());
  expect(added).toEqual(["a/one"]);
});

test("a second click on an added model takes it out of the form", async () => {
  let models: ModelListRow[] = [];
  let addMany: ((rows: Array<{ id: string }>) => void) | undefined;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  const render = () =>
    root!.render(
      <BrowsableModelFields<{ id: string }>
        browseLabel="Browse models"
        customModels={models}
        fieldId="test-models"
        onCustomModelsChange={(next) => {
          models = next;
        }}
        renderBrowse={({ onAddMany }) => {
          addMany = onAddMany;

          return null;
        }}
        toModelRow={(row) => ({ id: row.id })}
      />
    );

  await act(async () => render());
  await act(async () => addMany?.([{ id: "a/one" }]));
  expect(models.map((model) => model.id)).toEqual(["a/one"]);

  await act(async () => render());
  await act(async () => addMany?.([{ id: "a/one" }]));
  expect(models).toEqual([]);
});
