import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import type { CreateProviderResponse } from "@tinyclaw/core/contract";

interface SetupStepProviderProps {
  onNext: (result: CreateProviderResponse) => void;
}

export function SetupStepProvider({ onNext }: SetupStepProviderProps) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <ProviderSetupForm
        submitLabel="Continue"
        showHeading={false}
        density="compact"
        onSuccess={onNext}
      />
    </div>
  );
}