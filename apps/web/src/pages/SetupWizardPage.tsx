import { Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { SetupWizard } from "@/components/setup-wizard/SetupWizard";
import { SetupLayout } from "@/components/SetupLayout";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";
import { useAppContext } from "@/context/app-context";
import { pathForPage, SETUP_PATH } from "@/lib/navigation";

export function SetupWizardPage() {
  const { health, loading } = useAppContext();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
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
    return <Navigate to="/login" state={{ from: SETUP_PATH }} replace />;
  }

  if (isFullyConfigured && !wizardInProgress) {
    return <Navigate to={pathForPage("chat")} replace />;
  }

  return (
    <SetupLayout>
      <SetupWizard />
    </SetupLayout>
  );
}
