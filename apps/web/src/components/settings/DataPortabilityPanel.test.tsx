import { afterEach, expect, spyOn, test } from "bun:test";
import type { BackupStatusResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { DataPortabilityPanel } from "./DataPortabilityPanel";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

async function renderPanel(
  status: BackupStatusResponse | Error,
  cached?: BackupStatusResponse
): Promise<HTMLElement> {
  const backupStatus = spyOn(client, "getBackupStatus");

  if (status instanceof Error) {
    backupStatus.mockRejectedValue(status);
  } else {
    backupStatus.mockResolvedValue(status);
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    backupStatus.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  if (cached) {
    queryClient.setQueryData(queryKeys.backupStatus, cached);
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DataPortabilityPanel />
      </QueryClientProvider>
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(backupStatus).toHaveBeenCalledTimes(1);

  return container;
}

function alerts(container: HTMLElement): number {
  return container.querySelectorAll('[role="alert"]').length;
}

const message =
  "Cannot export a restorable backup: the server cannot read config.ini.";

test("shows the last scheduled backup's 409 with its path", async () => {
  const panel = await renderPanel({
    lastError: { at: "2026-11-03T02:00:00.000Z", message },
  });

  expect(alerts(panel)).toBe(1);
  expect(panel.textContent).toContain(message);
});

test("shows no backup error when the last scheduled backup was good", async () => {
  const panel = await renderPanel({ lastError: null });

  expect(alerts(panel)).toBe(0);
});

test("shows an alert when the backup status cannot be read", async () => {
  const panel = await renderPanel(new Error("network down"));

  expect(alerts(panel)).toBe(1);
});

test("hides an old failure when the status refetch fails", async () => {
  const panel = await renderPanel(new Error("network down"), {
    lastError: { at: "2026-11-03T02:00:00.000Z", message },
  });

  expect(alerts(panel)).toBe(1);
  expect(panel.textContent).not.toContain(message);
});
