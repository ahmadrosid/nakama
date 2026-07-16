export interface SetupOrganizationDraft {
  name: string;
  slug: string;
}

export interface SetupAccountDraft {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export const SETUP_STEPS = [
  { id: 1, label: "Account", required: true },
  { id: 2, label: "Organization", required: true },
  { id: 3, label: "Provider", required: true },
  { id: 4, label: "About You", required: false },
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number]["id"];

export interface SetupWizardProps {
  onComplete?: () => void;
}
