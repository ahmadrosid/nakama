import { cn } from "@nakama/ui/utils";
import { Plug01Icon } from "hugeicons-react";
import { useState } from "react";

interface ComposioToolkitLogoProps {
  className?: string;
  logoUrl: string | null | undefined;
  name: string;
}

export function ComposioToolkitLogo({
  name,
  logoUrl,
  className,
}: ComposioToolkitLogoProps) {
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !failed;

  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background",
        className
      )}
    >
      {showLogo ? (
        <img
          alt=""
          className="size-5 object-contain"
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          src={logoUrl ?? undefined}
        />
      ) : (
        <Plug01Icon aria-hidden className="size-4 text-muted-foreground" />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function ComposioCustomAuthSteps({ name }: { name: string }) {
  return (
    <>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Open the Composio project for this API key.</li>
        <li>
          Create a custom auth config for {name}. Enter the credentials that
          Composio requests.
        </li>
        <li>Return here and try Connect again.</li>
      </ol>
      <a
        className="text-sm underline underline-offset-3"
        href="https://next.docs.composio.dev/docs/auth-configuration/custom-auth-configs"
        rel="noreferrer"
        target="_blank"
      >
        View setup guide
      </a>
    </>
  );
}
