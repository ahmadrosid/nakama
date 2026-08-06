import type { ReactNode } from "react";
import { PairingStepTile } from "@/components/integration-settings.shared";
import { buttonVariants } from "@/components/ui/button-variants";
import { DISCORD_DEVELOPER_PORTAL_URL, DISCORD_SETUP_GUIDE_URL } from "@/lib/integration-docs";
import { cn } from "@/lib/utils";

export function DiscordPairingGuide({ inviteUrl }: { inviteUrl: string | null }) {
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Link in Discord</p>
        {inviteUrl ? (
          <a
            href={inviteUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
          >
            Invite bot to server
          </a>
        ) : null}
      </div>
      <div className="overflow-hidden border border-border">
        <PairingStepTile
          step={1}
          title="Invite the bot"
          className="border-b border-border"
          description={
            inviteUrl ? (
              <>
                Click{" "}
                <a
                  href={inviteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Invite bot to server
                </a>{" "}
                above, pick a server, and approve the permissions.
              </>
            ) : (
              <>
                Create an invite link in the{" "}
                <a
                  href={DISCORD_DEVELOPER_PORTAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  Developer Portal
                </a>{" "}
                and add the bot to a server. See the{" "}
                <a
                  href={DISCORD_SETUP_GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  setup guide
                </a>
                .
              </>
            )
          }
        />
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <PairingStepTile
            step={2}
            title="Open a DM"
            className="border-b border-border sm:border-b-0 sm:border-r"
            description={
              <>
                In that server, right-click the bot in the member list and choose{" "}
                <span className="font-medium text-foreground">Message</span>.
              </>
            }
          />
          <PairingStepTile
            step={3}
            title="Send the code"
            description="Paste the pairing code from above into that DM and send it."
          />
        </div>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
          Using the bot in a server?
        </summary>
        <div className="mt-3 overflow-hidden border border-border">
          <PairingStepTile
            step={1}
            title="Finish DM pairing first"
            className="border-b border-border"
            description="Server channels only work after you have linked your account in a private DM."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <PairingStepTile
              step={2}
              title="Enable Message Content Intent"
              className="border-b border-border sm:border-b-0 sm:border-r"
              description="Turn it on under Bot → Privileged Gateway Intents in the Developer Portal."
            />
            <PairingStepTile
              step={3}
              title="Re-invite the bot"
              className="border-b border-border"
              description="Discord only applies intent changes after you add the bot again with a fresh invite link."
            />
          </div>
          <PairingStepTile
            step={4}
            title="Trigger in channels"
            description="In a server channel, @mention the bot, reply to one of its messages, or use a slash command."
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
}: {
  label: string;
  description?: ReactNode;
  layout?: "inline" | "stacked";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-4 py-3",
        layout === "stacked"
          ? "flex flex-col gap-3"
          : "flex flex-wrap items-center justify-between gap-3",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {layout === "stacked" ? <div className="w-full min-w-0">{children}</div> : children}
    </div>
  );
}
