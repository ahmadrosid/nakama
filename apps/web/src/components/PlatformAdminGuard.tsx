import { Navigate, Outlet } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";

export function PlatformAdminGuard() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (!user?.isPlatformAdmin) {
    return <Navigate to="/chat" replace />;
  }

  return <Outlet />;
}
