export interface SetupAccountDraft {
  email: string;
  name: string;
  password: string;
  phone: string;
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

export type StoredAccountDraft = Omit<SetupAccountDraft, "password">;

const ACCOUNT_DRAFT_KEY = "nakama:setup-account-draft";

// The draft is best effort: storage errors must never block setup.
export function saveStoredAccountDraft({
  email,
  name,
  phone,
}: StoredAccountDraft): void {
  try {
    sessionStorage.setItem(
      ACCOUNT_DRAFT_KEY,
      JSON.stringify({ email, name, phone })
    );
  } catch {
    // Private mode or a full quota: the user retypes step 1 after a reload.
  }
}

export function loadStoredAccountDraft(): StoredAccountDraft | null {
  try {
    const stored = sessionStorage.getItem(ACCOUNT_DRAFT_KEY);

    if (stored === null) {
      return null;
    }

    // SAFETY: JSON.parse output only prefills editable fields; each one is coerced to a string below.
    const { email, name, phone } = JSON.parse(
      stored
    ) as Partial<StoredAccountDraft>;

    return {
      email: String(email ?? ""),
      name: String(name ?? ""),
      phone: String(phone ?? ""),
    };
  } catch {
    return null;
  }
}

export function clearStoredAccountDraft(): void {
  try {
    sessionStorage.removeItem(ACCOUNT_DRAFT_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
