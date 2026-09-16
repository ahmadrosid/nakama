import { Spinner } from "@nakama/ui/spinner";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/use-auth";
import { canAccessSystemPage } from "@/lib/navigation";
import { legacySystemDestination } from "@/pages/system-page.shared";

export function SystemPage() {
  const { user, activeOrg, isLoading } = useAuth();
  const [searchParams] = useSearchParams();
  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  if (!canAccessSystemPage(isPlatformAdmin, activeOrg?.role)) {
    return <Navigate replace to="/chat" />;
  }
  return (
    <Navigate
      replace
      to={legacySystemDestination(searchParams, isPlatformAdmin)}
    />
  );
}
