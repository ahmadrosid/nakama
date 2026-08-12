import {
  HashtagIcon,
  Key01Icon,
  Notification01Icon,
  Plug01Icon,
  RocketIcon,
  TelegramIcon,
  WhatsappIcon,
} from "hugeicons-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ComposioConnectionsCard } from "@/components/ComposioConnectionsCard";
import { ComposioSettingsCard } from "@/components/ComposioSettingsCard";
import { DiscordSettingsCard } from "@/components/DiscordSettingsCard";
import { LocalAuthTokenCard } from "@/components/LocalAuthTokenCard";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { TokenOptimizationCard } from "@/components/TokenOptimizationCard";
import { Spinner } from "@/components/ui/spinner";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { useAuth } from "@/context/use-auth";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

const INTEGRATION_SECTIONS = [
  {
    description: "Bot and pairing",
    icon: TelegramIcon,
    id: "telegram",
    label: "Telegram",
  },
  {
    description: "Bridge and device link",
    icon: WhatsappIcon,
    id: "whatsapp",
    label: "WhatsApp",
  },
  {
    description: "Bot and pairing",
    icon: HashtagIcon,
    id: "discord",
    label: "Discord",
  },
  {
    description: "Telegram webhooks",
    icon: Notification01Icon,
    id: "notifications",
    label: "Notifications",
  },
  {
    description: "SaaS app connections",
    icon: Plug01Icon,
    id: "composio",
    label: "Composio",
  },
  {
    description: "CLI and bridge access",
    icon: Key01Icon,
    id: "token",
    label: "Local token",
  },
  {
    description: "Tool output optimisers",
    icon: RocketIcon,
    id: "optimization",
    label: "Token optimisation",
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
    value === "optimization"
  ) {
    return value;
  }

  return "telegram";
}

export function IntegrationsPage() {
  const { activeOrg, isLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground text-sm">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (activeOrg?.role === "viewer") {
    return <Navigate replace to="/chat" />;
  }

  const isOrgAdmin = activeOrg?.role === "admin";
  const section = resolveSection(
    isOrgAdmin ? searchParams.get("section") : "composio"
  );
  const visibleSections = isOrgAdmin
    ? INTEGRATION_SECTIONS
    : INTEGRATION_SECTIONS.filter((item) => item.id === "composio");

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
    <section
      className={cn(
        sectionClass,
        "flex min-h-[calc(100dvh-11rem)] flex-col overflow-hidden"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-border border-b px-4 sm:px-5 md:w-56 md:border-r md:border-b-0 md:p-4">
          <nav
            aria-label="Integration settings"
            className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {visibleSections.map((item) => (
              <SidebarButton
                active={section === item.id}
                description={item.description}
                icon={item.icon}
                key={item.id}
                label={item.label}
                onClick={() => setSection(item.id)}
              />
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          {section === "token" ? <LocalAuthTokenCard /> : null}

          {section === "optimization" ? <TokenOptimizationCard /> : null}

          {section === "composio" ? (
            <div className={cn(isOrgAdmin && "space-y-4")}>
              {isOrgAdmin ? <ComposioSettingsCard embedded /> : null}
              <ComposioConnectionsCard bordered embedded />
            </div>
          ) : null}

          {section === "telegram" ? <TelegramSettingsCard /> : null}

          {section === "discord" ? <DiscordSettingsCard /> : null}

          {section === "notifications" ? (
            <NotificationDestinationsCard />
          ) : null}

          {section === "whatsapp" ? <WhatsAppSettingsCard /> : null}
        </div>
      </div>
    </section>
  );
}

function SidebarButton({
  label,
  description,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  description: string;
  icon: typeof TelegramIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "flex shrink-0 items-center gap-2 px-3 py-2.5 text-left outline-none transition-[color,background-color,border-color,box-shadow,scale] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.96] sm:px-4 md:w-full md:shrink md:gap-3 md:rounded-md md:px-2",
        active
          ? "bg-primary/10 text-foreground"
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
      <span className="min-w-0 md:space-y-0.5">
        <span className="block whitespace-nowrap font-medium text-sm leading-tight [text-wrap:balance] md:whitespace-normal">
          {label}
        </span>
        <span className="hidden text-muted-foreground text-xs leading-snug [text-wrap:pretty] md:block">
          {description}
        </span>
      </span>
    </button>
  );
}
