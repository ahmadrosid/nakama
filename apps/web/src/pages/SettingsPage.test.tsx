import { afterEach, expect, spyOn, test } from "bun:test";
import type { ListTimezonesResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { TimezoneSettingsRow } from "@/pages/SettingsPage";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function waitFor(check: () => boolean) {
  for (let tries = 0; tries < 50 && !check(); tries++) {
    await act(() => Bun.sleep(10));
  }
}

function zone(id: string, label: string, countryName: string) {
  return {
    abbreviation: "",
    city: label,
    countryCode: countryName.slice(0, 2).toUpperCase(),
    countryName,
    id,
    label,
    offset: "",
    tzName: id,
  };
}

const CATALOG: ListTimezonesResponse = {
  groups: [
    {
      countryCode: "DE",
      countryName: "Germany",
      timezones: [zone("Europe/Berlin", "Berlin", "Germany")],
    },
    {
      countryCode: "ID",
      countryName: "Indonesia",
      timezones: [zone("Asia/Jakarta", "Jakarta", "Indonesia")],
    },
  ],
};

test("a failed timezone save shows the error and the saved timezone again", async () => {
  const spies = [
    spyOn(client, "listTimezones").mockResolvedValue(CATALOG),
    spyOn(client, "getTimezone").mockResolvedValue("Asia/Jakarta"),
  ];

  const save = spyOn(client, "setTimezone").mockRejectedValue(
    new Error("Save failed")
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    for (const spy of [...spies, save]) {
      spy.mockRestore();
    }

    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TimezoneSettingsRow />
      </QueryClientProvider>
    );
  });

  const trigger = () => document.querySelector<HTMLElement>("#timezone");

  await waitFor(
    () => trigger()?.getAttribute("aria-label") === "Timezone: Jakarta"
  );
  expect(trigger()?.getAttribute("aria-label")).toBe("Timezone: Jakarta");

  await act(async () => trigger()?.click());

  const berlin = () =>
    [...document.querySelectorAll<HTMLElement>("[cmdk-item]")].find(
      (item) => item.getAttribute("data-value") === "Europe/Berlin"
    );

  await waitFor(() => berlin() !== undefined);
  await act(async () => berlin()?.click());

  await waitFor(() => document.querySelector('[role="alert"]') !== null);

  expect(save).toHaveBeenCalledWith("Europe/Berlin");
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(trigger()?.getAttribute("aria-label")).toBe("Timezone: Jakarta");
});
