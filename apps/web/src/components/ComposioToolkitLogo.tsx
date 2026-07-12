import { PlugIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ComposioToolkitLogoProps {
  name: string;
  logoUrl: string | null | undefined;
  className?: string;
}

export function ComposioToolkitLogo({ name, logoUrl, className }: ComposioToolkitLogoProps) {
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(logoUrl) && !failed;

  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
    >
      {showLogo ? (
        <img
          src={logoUrl ?? undefined}
          alt=""
          className="size-5 object-contain"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <PlugIcon className="size-4 text-muted-foreground" aria-hidden />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
