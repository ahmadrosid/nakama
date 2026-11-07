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

  const radio = (label: string) =>
    [
      ...document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ].find((input) => input.closest("label")?.textContent?.startsWith(label));

  const checked = () =>
    radio("Off")?.checked
      ? "off"
      : radio("Optional")?.checked
        ? "optional"
        : radio("Required")?.checked
          ? "required"
          : null;

  const button = (label: string) =>
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (element) => element.textContent?.trim() === label
    );

  return { button, checked, click, container, radio, update };
}

test("the card shows the saved policy as one of three choices", async () => {
  expect((await renderCard({ ...ENABLED, enabled: false })).checked()).toBe(
    "off"
  );
});

test("turning MFA off waits for the confirm", async () => {
  const card = await renderCard(ENABLED);
  expect(card.checked()).toBe("optional");

  await card.click(() => card.radio("Off"));
  expect(card.update).not.toHaveBeenCalled();
  expect(card.checked()).toBe("optional");

  await card.click(() => card.button("Turn off"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({ enabled: false, required: false });
});

test("Optional turns MFA on without a confirm", async () => {
  const card = await renderCard({ ...ENABLED, enabled: false });

  await card.click(() => card.radio("Optional"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({ enabled: true });
  expect(card.checked()).toBe("optional");
});

test("Required from Off waits for the confirm, then shows the roles", async () => {
  const card = await renderCard({ ...ENABLED, enabled: false });
  expect(card.button("Admins")).toBeUndefined();

  await card.click(() => card.radio("Required"));
  expect(card.update).not.toHaveBeenCalled();

  await card.click(() => card.button("Require"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({ enabled: true, required: true });
  expect(card.button("Admins")?.getAttribute("aria-pressed")).toBe("true");
});

test("Optional from Required drops the requirement without a confirm", async () => {
  const card = await renderCard({ ...ENABLED, required: true });

  await card.click(() => card.radio("Optional"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({ required: false });
});

test("adding a role while sign-in requires MFA waits for the confirm", async () => {
  const card = await renderCard({ ...ENABLED, required: true });

  await card.click(() => card.button("Members"));
  expect(card.update).not.toHaveBeenCalled();

  await card.click(() => card.button("Require"));
  await waitFor(() => card.update.mock.calls.length > 0);
  expect(card.update).toHaveBeenCalledWith({
    enforcedRoles: ["admin", "member"],
  });
});

test("the last selected role cannot be removed", async () => {
  const card = await renderCard({ ...ENABLED, required: true });

  expect(card.button("Admins")?.hasAttribute("disabled")).toBe(true);
});

test("a change made during a save is saved after it", async () => {
  const card = await renderCard({ ...ENABLED, enabled: false });
  let finishFirst: () => void = () => undefined;

  card.update.mockImplementationOnce(
    (input) =>
      new Promise((resolve) => {
        finishFirst = () => resolve({ ...ENABLED, ...input });
      })
  );

  await card.click(() => card.radio("Optional"));
  await card.click(() => card.radio("Required"));
  await card.click(() => card.button("Require"));
  expect(card.update).toHaveBeenCalledTimes(1);

  await act(async () => finishFirst());
  await waitFor(() => card.update.mock.calls.length > 1);
  expect(card.update.mock.calls.map(([input]) => input)).toEqual([
    { enabled: true },
    { required: true },
  ]);
});
