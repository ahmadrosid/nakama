import { Navigate, Outlet } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { useAppContext } from "@/context/app-context";
import { SETUP_PATH } from "@/lib/navigation";

export function SetupGuard() {
  const { health, loading, error } = useAppContext();

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <Outlet />;
  }

  if (health?.providerConfigured !== true) {
    return <Navigate to={SETUP_PATH} replace />;
  }

  return <Outlet />;
}
