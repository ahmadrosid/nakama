import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ModelListEditor, type ModelListRow } from "./ModelListEditor";

test("model ID edits preserve focused inputs and neighboring row identity", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let models: ModelListRow[] = [{ id: "existing" }];
  const render = (next: ModelListRow[]) => {
    models = next;
    root.render(<ModelListEditor models={models} onChange={render} />);
  };
  const inputs = () =>
    container.querySelectorAll<HTMLInputElement>(
      'input[placeholder="llama3.2"]'
    );
  try {
    await act(async () => render(models));
    const existing = inputs()[0]!;
    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add model")
    )!;
    await act(async () => add.click());
    const added = inputs()[1]!;
    added.focus();
    // Each render is the controlled parent accepting a model ID keystroke.
    for (const id of ["q", "qw", "existing", ""]) {
      await act(async () => render([models[0]!, { id }]));
      expect(inputs()[1] === added).toBe(true);
      expect(document.activeElement === added).toBe(true);
      expect(added.value).toBe(id);
    }
    existing.focus();
    await act(async () => render([{ id: "renamed" }, models[1]!]));
    expect(inputs()[0] === existing).toBe(true);
    expect(document.activeElement === existing).toBe(true);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Remove model"]')!
        .click()
    );
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0] === added).toBe(true);
    expect(models).toEqual([{ id: "" }]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
