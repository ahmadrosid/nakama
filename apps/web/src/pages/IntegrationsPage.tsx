import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BellRingIcon,
  BotIcon,
  HashIcon,
  KeyRoundIcon,
  MessageCircleMoreIcon,
  SendIcon,
} from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { CodingHarnessSettingsPanel } from "@/components/CodingHarnessSettingsDialog";
import { DiscordSettingsCard } from "@/components/DiscordSettingsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { LocalAuthTokenCard } from "@/components/LocalAuthTokenCard";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

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
    value === "coding-agents"
  ) {
    return value;
  }

  return "telegram";
}

export function IntegrationsPage() {
  const { activeOrg, isLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const section = resolveSection(searchParams.get("section"));

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (activeOrg?.role !== "admin") {
    return <Navigate to="/chat" replace />;
  }

  function setSection(nextSection: IntegrationSectionId) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (nextSection === "token") {
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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="type-page-title">Integrations</h1>
        <p className="type-body max-w-2xl">
          Manage bridge access, coding agents, Telegram and Discord setup, notification webhooks,
          and WhatsApp linking from one place.
        </p>
      </header>

      <div className="grid gap-8 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-start">
        <aside className="md:sticky md:top-6">
          <nav
            aria-label="Integration settings"
            className="flex gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-col md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden"
          >
            {INTEGRATION_SECTIONS.map((item) => (
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

        <section className="min-w-0">
          {section === "token" ? (
            <IntegrationSection
              title="Local token"
              description="This token is shared by local tools and message bridges running on this machine."
            >
              <LocalAuthTokenCard />
            </IntegrationSection>
          ) : null}

          {section === "coding-agents" ? <CodingHarnessSettingsPanel embedded /> : null}

          {section === "telegram" ? (
            <IntegrationSection
              title="Telegram"
              description="Connect your Telegram bot, choose the target profile, and finish pairing."
            >
              <TelegramSettingsCard />
            </IntegrationSection>
          ) : null}

          {section === "discord" ? (
            <div className="space-y-4">
              <SectionIntro
                title="Discord"
                description="Connect your Discord bot, choose the target profile, and finish DM pairing."
              />
              <DiscordSettingsCard />
            </div>
          ) : null}

          {section === "notifications" ? (
            <IntegrationSection
              title="Notification destinations"
              description="Create Telegram webhook destinations for alerts and lightweight notifications."
            >
              <NotificationDestinationsCard />
            </IntegrationSection>
          ) : null}

          {section === "whatsapp" ? (
            <IntegrationSection
              title="WhatsApp"
              description="Enable the bridge, choose a profile, then link a device with QR or pairing code."
            >
              <WhatsAppSettingsCard />
            </IntegrationSection>
          ) : null}
        </section>
      </div>
    </div>
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

function IntegrationSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1 px-1">
        <h2 className="type-section-title text-base">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
