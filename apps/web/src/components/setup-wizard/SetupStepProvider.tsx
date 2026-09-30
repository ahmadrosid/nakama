import type { CreateProviderResponse } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { useState } from "react";
import { ProviderSetupForm } from "@/components/ProviderSetupForm";
import { useUpdateProfileMutation } from "@/hooks/use-resource-mutations";
import { client, formatError } from "@/lib/client";
import { encodeModelSelection } from "@/lib/models";

interface SetupStepProviderProps {
  onNext: (result: CreateProviderResponse) => void;
  onSkip: () => void;
}

export function SetupStepProvider({ onNext, onSkip }: SetupStepProviderProps) {
  const updateProfile = useUpdateProfileMutation();
  const [provider, setProvider] = useState<CreateProviderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finishSetup(result: CreateProviderResponse) {
    setProvider(result);
    setBusy(true);
    setError(null);
    try {
      const { profiles } = await client.listProfiles();
      const starterProfiles = profiles.filter(
        (profile) => profile.isDefault || profile.isSuper
      );
      if (
        !(
          starterProfiles.some((profile) => profile.isDefault) &&
          starterProfiles.some((profile) => profile.isSuper)
        )
      ) {
        throw new Error(
          "Your starter profiles are not ready. Please try again."
        );
      }
      const model = encodeModelSelection(
        result.provider.id,
        result.initialModel
      );
      const updates = await Promise.allSettled(
        starterProfiles.map((profile) =>
          updateProfile.mutateAsync({
            input: { model },
            profileId: profile.id,
          })
        )
      );
      const failed = updates.find((update) => update.status === "rejected");
      if (failed?.status === "rejected") {
        throw failed.reason;
      }
      onNext(result);
    } catch (failure) {
      setError(formatError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-6">
      {provider ? (
        <div className="space-y-3">
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => void finishSetup(provider)}
            type="button"
          >
            {busy ? "Setting up your assistants…" : "Try again"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <ProviderSetupForm
            density="compact"
            onSuccess={(result) => void finishSetup(result)}
            showHeading={false}
            submitLabel="Continue"
          />
          <div className="flex justify-end border-border border-t pt-4">
            <button
              className="text-muted-foreground text-sm underline underline-offset-4 transition-colors hover:text-foreground"
              onClick={onSkip}
              type="button"
            >
              Set up later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
