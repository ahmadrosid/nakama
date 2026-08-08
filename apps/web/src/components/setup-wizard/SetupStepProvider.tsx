import type { CreateProviderResponse } from "@nakama/core/contract";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";

interface SetupStepProviderProps {
  onNext: (result: CreateProviderResponse) => void;
}

export function SetupStepProvider({ onNext }: SetupStepProviderProps) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <ProviderSetupForm
        density="compact"
        onSuccess={onNext}
        showHeading={false}
        submitLabel="Continue"
      />
    </div>
  );
}
