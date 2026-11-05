import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CatalogModelsBrowseList } from "./CatalogModelsBrowseList";

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
