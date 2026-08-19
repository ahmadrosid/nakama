import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { SetupLayout } from "@/components/SetupLayout";
import { SetupWizard } from "@/components/setup-wizard/SetupWizard";
import { Spinner } from "@/components/ui/spinner";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { pathForPage, SETUP_PATH } from "@/lib/navigation";

export function SetupWizardPage() {
  const { health, loading } = useAppContext();
  const {
    activeOrg,
    isAuthenticated,
    isLoading: authLoading,
    user,
  } = useAuth();
  const [wizardInProgress, setWizardInProgress] = useState(false);

  const isFullyConfigured =
    health?.userConfigured === true && health?.providerConfigured === true;

  // Allow finishing the wizard when setup flags flip true mid-flow (e.g. step 4
  // after provider is configured on step 3), but block fresh visits once done.
  useEffect(() => {
    if (health != null && !isFullyConfigured) {
      setWizardInProgress(true);
    }
  }, [health, isFullyConfigured]);

  if (loading || authLoading) {
    return (
      <SetupLayout>
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </SetupLayout>
    );
  }

  // Account/org already exist — provider setup needs an authenticated session.
  if (health?.userConfigured === true && !isAuthenticated) {
    return <Navigate replace state={{ from: SETUP_PATH }} to="/login" />;
  }

  if (isFullyConfigured && !wizardInProgress) {
    return <Navigate replace to={pathForPage("chat")} />;
  }

  // The provider is workspace-wide and only an admin may write it, so anyone
  // else landing here gets an explanation instead of a form that 403s.
  // Positive check only: while the org is still loading (right after step 1
  // creates it) activeOrg is undefined, and treating that as "not an admin"
  // would interrupt the wizard for the person running it.
  const knownNonAdmin =
    isAuthenticated &&
    user?.isPlatformAdmin !== true &&
    activeOrg != null &&
    activeOrg.role !== "admin";

  if (health?.userConfigured === true && knownNonAdmin) {
    return (
      <SetupLayout>
        <div className="space-y-2 py-8 text-center">
          <p className="font-medium text-foreground text-sm">
            Setup is not finished yet
          </p>
          <p className="text-muted-foreground text-sm">
            An admin needs to connect a model provider before you can start
            chatting.
          </p>
        </div>
      </SetupLayout>
    );
  }

  return (
    <SetupLayout>
      <SetupWizard />
    </SetupLayout>
  );
}
