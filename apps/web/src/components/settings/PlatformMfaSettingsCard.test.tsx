import { afterEach, expect, spyOn, test } from "bun:test";
import type { MfaPolicyResponse } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { PlatformMfaSettingsCard } from "./PlatformMfaSettingsCard";

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

const ENABLED: MfaPolicyResponse = {
  enabled: true,
  enforcedRoles: ["admin"],
  keyConfigured: true,
  required: false,
};

async function renderCard(policy: MfaPolicyResponse) {
  const load = spyOn(client, "getMfaPolicy").mockResolvedValue(policy);

  const update = spyOn(client, "updateMfaPolicy").mockImplementation(
    async (input) => ({ ...policy, ...input })
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    load.mockRestore();
    update.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => root.render(<PlatformMfaSettingsCard />));
  await waitFor(() => !container.querySelector("[aria-busy]"));

  const click = async (selector: () => HTMLElement | undefined) => {
    const target = selector();
    expect(target).toBeDefined();
    await act(async () => target?.click());
    await act(() => Bun.sleep(0));
  };

  const control = (label: string) =>
    document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? undefined;

  const button = (label: string) =>
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (element) => element.textContent?.trim() === label
    );

  return { button, click, container, control, update };
}

test("turning MFA off for all users waits for the confirm", async () => {
  const card = await renderCard(ENABLED);

  await card.click(() => card.control("MFA for all users"));
  expect(card.update).not.toHaveBeenCalled();

  await card.click(() => card.button("Turn off"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({ enabled: false, required: false });
});

test("roles can be picked before sign-in requires MFA", async () => {
  const card = await renderCard(ENABLED);

  expect(card.control("Required for: Admins")).toBeDefined();

  await card.click(() => card.control("Require for sign-in"));
  expect(card.update).not.toHaveBeenCalled();

  await card.click(() => card.button("Require"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({ required: true });
});
