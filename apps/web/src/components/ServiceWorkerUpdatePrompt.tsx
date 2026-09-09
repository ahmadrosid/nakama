import { RefreshIcon } from "hugeicons-react";
import { Button } from "@/components/ui/button";
import { useServiceWorkerUpdate } from "@/hooks/use-service-worker-update";

export function ServiceWorkerUpdatePrompt() {
  const { applyUpdate, updateReady } = useServiceWorkerUpdate();

  if (!updateReady) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-full border border-border bg-card py-2 pr-2 pl-4 shadow-lg"
      role="status"
    >
      <p className="text-foreground text-sm">A new version is ready.</p>
      <Button onClick={applyUpdate} size="sm" type="button">
        <RefreshIcon aria-hidden="true" className="size-4" strokeWidth={1.75} />
        Reload
      </Button>
    </div>
  );
}
