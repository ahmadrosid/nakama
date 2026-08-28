import { Navigate } from "react-router-dom";
import { OrganizationPanel } from "@/components/system/OrganizationPanel";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { canAccessSystemPage } from "@/lib/navigation";

export function OrganizationPage() {
  const { user, activeOrg, isLoading } = useAuth();
  const canAccess = canAccessSystemPage(
    user?.isPlatformAdmin === true,
    activeOrg?.role
  );

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground text-sm">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (!canAccess) {
    return <Navigate replace to="/chat" />;
  }

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <OrganizationPanel />
    </section>
  );
}
