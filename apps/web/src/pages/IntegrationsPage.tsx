import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import {
  Bug01Icon,
  CodeIcon,
  CpuChargeIcon,
  HashtagIcon,
  Key01Icon,
  Notification01Icon,
  Plug01Icon,
  TelegramIcon,
  WhatsappIcon,
} from "hugeicons-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { CodingAgentsSettingsCard } from "@/components/CodingAgentsSettingsCard";
import { ComposioConnectionsCard } from "@/components/ComposioConnectionsCard";
import { ComposioSettingsCard } from "@/components/ComposioSettingsCard";
import { DiscordSettingsCard } from "@/components/DiscordSettingsCard";
import { ErrorTrackingSettingsCard } from "@/components/ErrorTrackingSettingsCard";
import { LocalAuthTokenCard } from "@/components/LocalAuthTokenCard";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { TokenOptimizationCard } from "@/components/TokenOptimizationCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { useAuth } from "@/context/use-auth";

const INTEGRATION_SECTIONS = [
  {
    icon: TelegramIcon,
    id: "telegram",
    label: "Telegram",
  },
  {
    icon: WhatsappIcon,
    id: "whatsapp",
    label: "WhatsApp",
  },
  {
    icon: HashtagIcon,
    id: "discord",
    label: "Discord",
  },
  {
    icon: Notification01Icon,
    id: "notifications",
    label: "Notifications",
  },
  {
    icon: Plug01Icon,
    id: "composio",
    label: "Composio",
  },
  {
    icon: Key01Icon,
    id: "token",
    label: "Local token",
  },
  {
    icon: CodeIcon,
    id: "coding-agents",
    label: "Coding agents",
  },
  {
    icon: CpuChargeIcon,
    id: "optimization",
    label: "Context savings",
  },
  {
    icon: Bug01Icon,
    id: "error-tracking",
    label: "Error tracking",
  },
] as const;

type IntegrationSectionId = (typeof INTEGRATION_SECTIONS)[number]["id"];

function resolveSection(value: string | null): IntegrationSectionId {
  if (
    value === "token" ||
    value === "notifications" ||
    value === "whatsapp" ||
    value === "discord" ||
    value === "composio" ||
    value === "optimization" ||
    value === "error-tracking" ||
    value === "coding-agents"
  ) {
    return value;
  }

  return "telegram";
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
  if (section === "token") {
    return <LocalAuthTokenCard />;
  }

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

  if (section === "telegram") {
    return <TelegramSettingsCard />;
  }

  if (section === "discord") {
    return <DiscordSettingsCard />;
  }

  if (section === "notifications") {
    return <NotificationDestinationsCard />;
  }

  if (section === "error-tracking") {
    return <ErrorTrackingSettingsCard />;
  }

  return <WhatsAppSettingsCard />;
}

function IntegrationsPageBody({
  canUseOrgIntegrations,
  isOrgAdmin,
  isPlatformAdmin,
}: {
  canUseOrgIntegrations: boolean;
  isOrgAdmin: boolean;
  isPlatformAdmin: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = resolveSection(searchParams.get("section"));
  const visibleSections = INTEGRATION_SECTIONS.filter((item) => {
    if (item.id === "composio") {
      return true;
    }
    if (
      item.id === "discord" ||
      item.id === "whatsapp" ||
      item.id === "error-tracking"
    ) {
      return isPlatformAdmin;
    }
    return isOrgAdmin;
  });
  const section = visibleSections.some((item) => item.id === requestedSection)
    ? requestedSection
    : visibleSections[0].id;

  function setSection(nextSection: IntegrationSectionId) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextSection === "telegram") {
          next.delete("section");
        } else {
          next.set("section", nextSection);
        }
        return next;
      },
      { replace: true }
    );
  }

  return (
    <section className="mx-auto w-full min-w-0 max-w-5xl">
      <div className="flex min-w-0 flex-col gap-6 md:flex-row">
        <aside className="shrink-0 self-start overflow-hidden rounded-xl border border-border bg-card max-md:w-full md:w-48">
          <nav
            aria-label="Integration settings"
            className="flex overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:divide-y md:divide-border md:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {visibleSections.map((item) => (
              <SidebarButton
                active={section === item.id}
                icon={item.icon}
                key={item.id}
                label={item.label}
                onClick={() => setSection(item.id)}
              />
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-8">
          <IntegrationSectionPanel
            canUseOrgIntegrations={canUseOrgIntegrations}
            isPlatformAdmin={isPlatformAdmin}
            section={section}
          />
        </div>
      </div>
    </section>
  );
}

export function IntegrationsPage() {
  const { activeOrg, isLoading, user } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground text-sm">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (activeOrg?.role === "viewer" && !isPlatformAdmin) {
    return <Navigate replace to="/chat" />;
  }

  return (
    <IntegrationsPageBody
      canUseOrgIntegrations={Boolean(activeOrg && activeOrg.role !== "viewer")}
      isOrgAdmin={activeOrg?.role === "admin"}
      isPlatformAdmin={isPlatformAdmin}
    />
  );
}

function SidebarButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof TelegramIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:w-full md:shrink",
        active
          ? "bg-muted/50 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      <Icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground"
        )}
        strokeWidth={1.75}
      />
      <span className="min-w-0 whitespace-nowrap font-normal text-sm leading-tight [text-wrap:balance] md:whitespace-normal">
        {label}
      </span>
    </button>
  );
}
