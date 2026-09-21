import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { CodingAgentsSettingsCard } from "@/components/CodingAgentsSettingsCard";
import { ComposioConnectionsCard } from "@/components/ComposioConnectionsCard";
import { ComposioSettingsCard } from "@/components/ComposioSettingsCard";
import { ErrorTrackingSettingsCard } from "@/components/ErrorTrackingSettingsCard";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { TokenOptimizationCard } from "@/components/TokenOptimizationCard";
import { useAuth } from "@/context/use-auth";
import {
  type IntegrationSectionId,
  visibleIntegrationSections,
} from "@/lib/navigation";

function resolveSection(value: string | null): IntegrationSectionId {
  if (
    value === "notifications" ||
    value === "composio" ||
    value === "optimization" ||
    value === "error-tracking" ||
    value === "coding-agents"
  ) {
    return value;
  }

  return "composio";
}

function IntegrationSectionPanel({
  canUseOrgIntegrations,
  section,
  isPlatformAdmin,
}: {
  canUseOrgIntegrations: boolean;
  section: IntegrationSectionId;
  isPlatformAdmin: boolean;
}) {
  if (section === "optimization") {
    return <TokenOptimizationCard />;
  }

  if (section === "coding-agents") {
    return <CodingAgentsSettingsCard />;
  }

  if (section === "composio") {
    return (
      <div className={cn(isPlatformAdmin && "space-y-4")}>
        {isPlatformAdmin ? <ComposioSettingsCard embedded /> : null}
        {canUseOrgIntegrations ? (
          <ComposioConnectionsCard bordered embedded />
        ) : null}
      </div>
    );
  }

  if (section === "notifications") {
    return <NotificationDestinationsCard />;
  }

  if (section === "error-tracking") {
    return <ErrorTrackingSettingsCard />;
  }

  return null;
}

export function IntegrationsPage() {
  const [searchParams] = useSearchParams();
  const { section } = useParams();
  const { activeOrg, isLoading, user } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  if (isLoading) {
    return <Spinner className="size-5" />;
  }
  if (!section) {
    if (searchParams.get("section") === "token") {
      return <Navigate replace to="/settings#local-token" />;
    }
    const target = resolveSection(searchParams.get("section"));
    const remaining = new URLSearchParams(searchParams);
    remaining.delete("section");
    return (
      <Navigate
        replace
        to={`/customize/connections/${target}${remaining.size ? `?${remaining}` : ""}`}
      />
    );
  }
  const selected = visibleIntegrationSections(
    isPlatformAdmin,
    activeOrg?.role
  ).find((item) => item.id === section);
  if (!selected) {
    return <Navigate replace to="/customize" />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        className="block w-fit text-muted-foreground text-sm hover:text-foreground"
        to="/customize"
      >
        ← Back to Control center
      </Link>
      <h1 className="font-medium text-xl">{selected.label}</h1>
      <IntegrationSectionPanel
        canUseOrgIntegrations={Boolean(
          activeOrg && activeOrg.role !== "viewer"
        )}
        isPlatformAdmin={isPlatformAdmin}
        section={selected.id}
      />
    </div>
  );
}
