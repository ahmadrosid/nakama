import type { LucideIcon } from "lucide-react";
import {
  BellRingIcon,
  BotIcon,
  KeyRoundIcon,
  MessageCircleMoreIcon,
  SendIcon,
} from "lucide-react";
import { Navigate, useSearchParams } from "react-router-dom";
import { CodingHarnessSettingsPanel } from "@/components/CodingHarnessSettingsDialog";
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
          Manage bridge access, coding agents, Telegram setup, notification webhooks, and
          WhatsApp linking from one place.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="rounded-md border border-border bg-card p-2 lg:sticky lg:top-6">
          <nav
            aria-label="Integration settings"
            className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible"
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

        <section className="min-w-0 space-y-6">
          {section === "token" ? (
            <div className="space-y-4">
              <SectionIntro
                title="Local token"
                description="This token is shared by local tools and message bridges running on this machine."
              />
              <LocalAuthTokenCard />
            </div>
          ) : null}

          {section === "coding-agents" ? (
            <div className="space-y-4">
              <SectionIntro
                title="Coding agents"
                description="Choose which CLI agent Nakama can use for delegated code work on this server."
              />
              <CodingHarnessSettingsPanel embedded />
            </div>
          ) : null}

          {section === "telegram" ? (
            <div className="space-y-4">
              <SectionIntro
                title="Telegram"
                description="Connect your Telegram bot, choose the target profile, and finish pairing."
              />
              <TelegramSettingsCard />
            </div>
          ) : null}

          {section === "notifications" ? (
            <div className="space-y-4">
              <SectionIntro
                title="Notification destinations"
                description="Create Telegram webhook destinations for alerts and lightweight notifications."
              />
              <NotificationDestinationsCard />
            </div>
          ) : null}

          {section === "whatsapp" ? (
            <div className="space-y-4">
              <SectionIntro
                title="WhatsApp"
                description="Enable the bridge, choose a profile, then link a device with QR or pairing code."
              />
              <WhatsAppSettingsCard />
            </div>
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
        "flex min-w-[11rem] flex-1 items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors lg:min-w-0",
        active
          ? "border-foreground/15 bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function SectionIntro({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <h2 className="type-section-title">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
