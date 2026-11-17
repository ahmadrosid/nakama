import { Spinner } from "@nakama/ui/spinner";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/use-auth";

export function AuthGuard() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Back to this page after sign-in, for example the desktop Connect link.
    return (
      <Navigate
        replace
        state={{ from: `${location.pathname}${location.search}` }}
        to="/login"
      />
    );
  }

  if (
    user?.mfaRequired &&
    !user.mfaEnrolled &&
    location.pathname !== "/settings/preferences"
  ) {
    return <Navigate replace to="/settings/preferences?mfa=required" />;
  }

  return <Outlet />;
}
