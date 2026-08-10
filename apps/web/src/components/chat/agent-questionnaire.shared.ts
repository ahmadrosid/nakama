export interface DraftAnswerState {
  customAnswer: string;
  selectedChoiceId: string | null;
  selectedChoiceLabel: string | null;
}

export function isCustomChoice(choice: { id: string; label: string }): boolean {
  const value = `${choice.id} ${choice.label}`.toLowerCase();
  return value.includes("other") || value.includes("custom");
}
