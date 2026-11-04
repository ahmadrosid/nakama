import { afterEach, expect, spyOn, test } from "bun:test";
import type { BackupStatusResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { DataPortabilityPanel } from "./DataPortabilityPanel";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

async function renderPanel(
  status: BackupStatusResponse | Error
): Promise<string> {
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

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <DataPortabilityPanel />
      </QueryClientProvider>
    );
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(backupStatus).toHaveBeenCalledTimes(1);

  return container.textContent ?? "";
}

const message =
  "Cannot export a restorable backup: the server cannot read config.ini.";

test("shows the last scheduled backup's 409 with its path", async () => {
  const text = await renderPanel({
    lastError: { at: "2026-11-03T02:00:00.000Z", message },
  });

  expect(text).toContain(message);
});

test("shows no backup error when the last scheduled backup was good", async () => {
  const text = await renderPanel({ lastError: null });

  expect(text).not.toContain(message);
});

test("does not look like a good backup when the status cannot be read", async () => {
  const good = await renderPanel({ lastError: null });

  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }

  const failed = await renderPanel(new Error("network down"));

  expect(failed).not.toBe(good);
});
