import type { LucideIcon } from "lucide-react";
import {
  BellRingIcon,
  HashIcon,
  KeyRoundIcon,
  MessageCircleMoreIcon,
  PlugIcon,
  SendIcon,
} from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { DiscordSettingsCard } from "@/components/DiscordSettingsCard";
import { ComposioSettingsCard } from "@/components/ComposioSettingsCard";
import { ComposioConnectionsCard } from "@/components/ComposioConnectionsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { LocalAuthTokenCard } from "@/components/LocalAuthTokenCard";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

const INTEGRATION_SECTIONS = [
  {
    id: "telegram",
    label: "Telegram",
    description: "Bot and pairing",
    icon: SendIcon,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Bridge and device link",
    icon: MessageCircleMoreIcon,
  },
  {
    id: "discord",
    label: "Discord",
    description: "Bot and pairing",
    icon: HashIcon,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "Telegram webhooks",
    icon: BellRingIcon,
  },
  {
    id: "composio",
    label: "Composio",
    description: "SaaS app connections",
    icon: PlugIcon,
  },
  {
    id: "token",
    label: "Local token",
    description: "CLI and bridge access",
    icon: KeyRoundIcon,
  },
] as const;

type IntegrationSectionId = (typeof INTEGRATION_SECTIONS)[number]["id"];

function resolveSection(value: string | null): IntegrationSectionId {
  if (
    value === "token" ||
    value === "notifications" ||
    value === "whatsapp" ||
    value === "discord" ||
    value === "composio"
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
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (activeOrg?.role === "viewer") {
    return <Navigate to="/chat" replace />;
  }

  const isOrgAdmin = activeOrg?.role === "admin";
  const section = resolveSection(isOrgAdmin ? searchParams.get("section") : "composio");
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
      { replace: true },
    );
  }

  return (
    <section className={cn(sectionClass, "flex min-h-[calc(100dvh-11rem)] flex-col overflow-hidden")}>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-border px-4 sm:px-5 md:w-56 md:border-r md:border-b-0 md:p-4">
          <nav
            aria-label="Integration settings"
            className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {visibleSections.map((item) => (
              <SidebarButton
                key={item.id}
                label={item.label}
                description={item.description}
                icon={item.icon}
                active={section === item.id}
                onClick={() => setSection(item.id)}
              />
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          {section === "token" ? <LocalAuthTokenCard /> : null}

          {section === "composio" ? (
            <div className={cn(isOrgAdmin && "space-y-4")}>
              {isOrgAdmin ? <ComposioSettingsCard embedded /> : null}
              <ComposioConnectionsCard embedded bordered />
            </div>
          ) : null}

          {section === "telegram" ? <TelegramSettingsCard /> : null}

          {section === "discord" ? <DiscordSettingsCard /> : null}

          {section === "notifications" ? <NotificationDestinationsCard /> : null}

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
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-2 px-3 py-2.5 text-left outline-none transition-[color,background-color,border-color,box-shadow,scale] active:scale-[0.96] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-4 md:w-full md:shrink md:gap-3 md:rounded-md md:px-2",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="min-w-0 md:space-y-0.5">
        <span className="block text-sm font-medium leading-tight whitespace-nowrap [text-wrap:balance] md:whitespace-normal">
          {label}
        </span>
        <span className="hidden text-xs leading-snug text-muted-foreground [text-wrap:pretty] md:block">
          {description}
        </span>
      </span>
    </button>
  );
}
