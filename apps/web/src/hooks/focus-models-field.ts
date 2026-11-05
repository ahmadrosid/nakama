// The models field has no single input. "Add model by ID" (marked with
// data-models-add) works even when the endpoint cannot list models, so it
// takes focus first.
export function focusModelsField() {
  const label = document.querySelector('label[for$="-models"]');
  const field = label?.parentElement?.parentElement;

  field?.scrollIntoView({ block: "center" });
  (
    field?.querySelector<HTMLElement>("[data-models-add]") ??
    field?.querySelector<HTMLElement>("input, button")
  )?.focus();
}
