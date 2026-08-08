import { PlugIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

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
        <PlugIcon aria-hidden className="size-4 text-muted-foreground" />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
