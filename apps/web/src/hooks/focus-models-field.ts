// The models field has no single input. "Add model by ID" works even when
// the endpoint cannot list models, so it takes focus first.
export function focusModelsField() {
  const label = document.querySelector('label[for$="-models"]');
  const field = label?.parentElement?.parentElement;

  const addById = [...(field?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent?.trim() === "Add model by ID"
  );

  field?.scrollIntoView({ block: "center" });
  (addById ?? field?.querySelector<HTMLElement>("input, button"))?.focus();
}
