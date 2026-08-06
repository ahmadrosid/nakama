import type { ReactNode } from "react";

type SettingsModelTileProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function SettingsModelTile({ title, children, footer }: SettingsModelTileProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {footer}
      </div>
      <div className="min-w-0 w-full sm:w-56">{children}</div>
    </div>
  );
}
