import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  Link,
  Navigate,
  useMatch,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { CodingAgentsSettingsCard } from "@/components/CodingAgentsSettingsCard";
import { ComposioConnectionsCard } from "@/components/ComposioConnectionsCard";
import { ErrorTrackingSettingsCard } from "@/components/ErrorTrackingSettingsCard";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { useAuth } from "@/context/use-auth";
import {
  canAccessSystemPage,
  type IntegrationSectionId,
  integrationSectionPath,
  PAGE_PATHS,
  visibleIntegrationSections,
} from "@/lib/navigation";

const INTEGRATION_TABS = [
  { label: "Connectors", path: PAGE_PATHS.composio },
  { label: "Plugins", path: PAGE_PATHS["plugin-management"] },
] as const;

/** Connectors and Plugins share one sidebar item; this switches between them. */
export function IntegrationsTabs() {
  const { activeOrg, user } = useAuth();
  const onConnectors = useMatch(PAGE_PATHS.composio) !== null;

  if (!canAccessSystemPage(user?.isPlatformAdmin === true, activeOrg?.role)) {
    return null;
  }

  return (
    <nav
      aria-label="Connections"
      className="mx-auto mb-6 flex max-w-4xl gap-6 border-border border-b"
    >
      {INTEGRATION_TABS.map((tab) => {
        const active = (tab.path === PAGE_PATHS.composio) === onConnectors;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 py-3 text-sm",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            key={tab.path}
            to={tab.path}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function resolveSection(value: string | null): IntegrationSectionId {
  if (
    value === "notifications" ||
    value === "composio" ||
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
}: {
  canUseOrgIntegrations: boolean;
  section: IntegrationSectionId;
}) {
  if (section === "coding-agents") {
    return <CodingAgentsSettingsCard />;
  }

  if (section === "composio") {
    return canUseOrgIntegrations ? (
      <ComposioConnectionsCard bordered embedded />
    ) : null;
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
  const params = useParams();
  const onConnectors = useMatch(PAGE_PATHS.composio) !== null;
  const section = onConnectors ? "composio" : params.section;
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
        to={`${integrationSectionPath(target)}${remaining.size ? `?${remaining}` : ""}`}
      />
    );
  }

  if (!onConnectors && section === "composio") {
    return <Navigate replace to={integrationSectionPath("composio")} />;
  }

  const selected = visibleIntegrationSections(
    isPlatformAdmin,
    activeOrg?.role
  ).find((item) => item.id === section);

  if (!selected) {
    return <Navigate replace to="/customize" />;
  }

  return (
    <div
      className={cn(
        "mx-auto space-y-6",
        onConnectors ? "min-w-0 max-w-4xl" : "max-w-3xl"
      )}
    >
      {onConnectors ? null : (
        <Link
          className="block w-fit text-muted-foreground text-sm hover:text-foreground"
          to="/customize"
        >
          ← Back to Control center
        </Link>
      )}
      {onConnectors ? null : (
        <h1 className="font-medium text-xl">{selected.label}</h1>
      )}
      <IntegrationSectionPanel
        canUseOrgIntegrations={Boolean(activeOrg)}
        section={selected.id}
      />
    </div>
  );
}
