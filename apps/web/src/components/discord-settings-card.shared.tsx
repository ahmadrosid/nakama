import type { ReactNode } from "react";
import { PairingStepTile } from "@/components/integration-settings.shared";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  DISCORD_DEVELOPER_PORTAL_URL,
  DISCORD_SETUP_GUIDE_URL,
} from "@/lib/integration-docs";
import { cn } from "@/lib/utils";

export function DiscordPairingGuide({
  inviteUrl,
  compact = false,
}: {
  inviteUrl: string | null;
  compact?: boolean;
}) {
  return (
    <div className={cn("space-y-3", !compact && "px-4 py-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground text-xs">Link in Discord</p>
        {inviteUrl ? (
          <a
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "h-7 text-xs"
            )}
            href={inviteUrl}
            rel="noreferrer"
            target="_blank"
          >
            Invite bot to server
          </a>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <PairingStepTile
          className="border-border border-b"
          description={
            inviteUrl ? (
              <>
                Click{" "}
                <a
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  href={inviteUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Invite bot to server
                </a>{" "}
                above, pick a server, and approve the permissions.
              </>
            ) : (
              <>
                Create an invite link in the{" "}
                <a
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  href={DISCORD_DEVELOPER_PORTAL_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Developer Portal
                </a>{" "}
                and add the bot to a server. See the{" "}
                <a
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  href={DISCORD_SETUP_GUIDE_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  setup guide
                </a>
                .
              </>
            )
          }
          step={1}
          title="Invite the bot"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <PairingStepTile
            className="border-border border-b sm:border-r sm:border-b-0"
            description={
              <>
                In that server, right-click the bot in the member list and
                choose{" "}
                <span className="font-medium text-foreground">Message</span>.
              </>
            }
            step={2}
            title="Open a DM"
          />
          <PairingStepTile
            description="Paste the pairing code from above into that DM and send it."
            step={3}
            title="Send the code"
          />
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-muted-foreground text-xs transition-colors hover:text-foreground">
          Using the bot in a server?
        </summary>
        <div className="mt-3 overflow-hidden rounded-md border border-border">
          <PairingStepTile
            className="border-border border-b"
            description="Server channels only work after you have linked your account in a private DM."
            step={1}
            title="Finish DM pairing first"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <PairingStepTile
              className="border-border border-b sm:border-r sm:border-b-0"
              description="Turn it on under Bot → Privileged Gateway Intents in the Developer Portal."
              step={2}
              title="Enable Message Content Intent"
            />
            <PairingStepTile
              className="border-border border-b"
              description="Discord only applies intent changes after you add the bot again with a fresh invite link."
              step={3}
              title="Re-invite the bot"
            />
          </div>
          <PairingStepTile
            description="In a server channel, @mention the bot, reply to one of its messages, or use a slash command."
            step={4}
            title="Trigger in channels"
          />
        </div>
      </details>
    </div>
  );
}

export function SettingsRow({
  label,
  description,
  layout = "inline",
  children,
  className,
}: {
  label: string;
  description?: ReactNode;
  layout?: "inline" | "stacked";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3",
        layout === "stacked"
          ? "flex flex-col gap-3"
          : "flex flex-wrap items-center justify-between gap-3",
        className
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-foreground text-sm">{label}</p>
        {description ? (
          <p className="text-muted-foreground text-xs [text-wrap:pretty]">
            {description}
          </p>
        ) : null}
      </div>
      {layout === "stacked" ? (
        <div className="w-full min-w-0">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
