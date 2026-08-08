import type { ReactNode } from "react";

type SettingsModelTileProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function SettingsModelTile({
  title,
  children,
  footer,
}: SettingsModelTileProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-foreground text-sm">{title}</p>
        {footer}
      </div>
      <div className="w-full min-w-0 sm:w-56">{children}</div>
    </div>
  );
}
