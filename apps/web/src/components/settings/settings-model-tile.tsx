import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SettingsModelTileProps = {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function SettingsModelTile({
  icon: Icon,
  iconClassName,
  title,
  children,
  footer,
}: SettingsModelTileProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-5 text-center shadow-none">
      <div
        className={cn(
          "flex size-9 items-center justify-center rounded-lg",
          iconClassName,
        )}
      >
        <Icon aria-hidden className="size-4" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="w-full text-left">{children}</div>
      {footer ? <div className="w-full text-left">{footer}</div> : null}
    </div>
  );
}
