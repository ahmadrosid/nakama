import type { ReactNode } from "react";
import { useAppContext } from "@/context/use-app-context";

interface SetupLayoutProps {
  children: ReactNode;
}

export function SetupLayout({ children }: SetupLayoutProps) {
  const { error } = useAppContext();

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      {error ? (
        <div className="shrink-0 border-red-200 border-b bg-red-50 px-6 py-3 text-red-800 text-sm dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col items-center px-6 py-10">
          <main className="w-full max-w-3xl">{children}</main>
        </div>
      </div>
    </div>
  );
}
