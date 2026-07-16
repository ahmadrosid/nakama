import type { LucideIcon } from "lucide-react";
import {
  BellRingIcon,
  BotIcon,
  HashIcon,
  KeyRoundIcon,
  MessageCircleMoreIcon,
  PlugIcon,
  SendIcon,
} from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { CodingHarnessSettingsPanel } from "@/components/CodingHarnessSettingsDialog";
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
    id: "coding-agents",
    label: "Coding agents",
    description: "Coding agent CLI",
    icon: BotIcon,
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
    value === "composio" ||
    value === "coding-agents"
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
        <aside className="shrink-0 border-b border-border p-4 md:w-56 md:border-r md:border-b-0">
          <nav
            aria-label="Integration settings"
            className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden"
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

          {section === "coding-agents" ? <CodingHarnessSettingsPanel embedded /> : null}

          {section === "composio" ? (
            <div className="space-y-4">
              {isOrgAdmin ? <ComposioSettingsCard /> : null}
              <ComposioConnectionsCard />
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
        "flex w-[11rem] shrink-0 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors md:w-full md:shrink",
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
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium leading-tight">{label}</span>
        <span className="block text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}
