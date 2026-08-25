import { Navigate, Outlet } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { canAccessSystemPage } from "@/lib/navigation";

export function OrgAdminOrPlatformAdminGuard() {
  const { user, activeOrg, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!canAccessSystemPage(user?.isPlatformAdmin === true, activeOrg?.role)) {
    return <Navigate replace to="/chat" />;
  }

  return <Outlet />;
}
