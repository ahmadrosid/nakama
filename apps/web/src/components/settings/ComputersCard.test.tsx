import { afterEach, expect, spyOn, test } from "bun:test";
import type { ComputerSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { ComputersCard, NakamaCloudCard } from "./BrowserSessionsCard";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

test("lists this account's computers and removes one on click", async () => {
  let computers: ComputerSummary[] = [
    {
      createdAt: "2026-11-01T00:00:00.000Z",
      id: "computer_1",
      lastSeenAt: null,
      name: "Ada's MacBook",
    },
  ];

  const list = spyOn(client, "listComputers").mockImplementation(async () => ({
    computers,
  }));

  const remove = spyOn(client, "removeComputer").mockImplementation(
    async (computerId) => {
      computers = computers.filter((computer) => computer.id !== computerId);
    }
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    list.mockRestore();
    remove.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ComputersCard />
      </QueryClientProvider>
    );
  });
  await settle();

  expect(container.textContent).toContain("Ada's MacBook");

  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Remove Ada\'s MacBook"]'
      )
      ?.click();
  });
  await settle();
  await settle();

  expect(remove).toHaveBeenCalledWith("computer_1");
  expect(container.textContent).not.toContain("Ada's MacBook");
  expect(container.textContent).toContain("No computers");
});

test("shows the Nakama Cloud account only when signed in, and signs out on click", async () => {
  let signedIn = true;

  const status = spyOn(client, "getNakamaCloudStatus").mockImplementation(
    async () => ({
      account: signedIn ? "ada@example.com" : null,
      cloudUrl: signedIn ? "https://withnakama.com" : null,
      needsSignIn: false,
      orgName: signedIn ? "Acme" : null,
      signedIn,
    })
  );

  const signOut = spyOn(client, "signOutNakamaCloud").mockImplementation(
    async () => {
      signedIn = false;
    }
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    status.mockRestore();
    signOut.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NakamaCloudCard />
      </QueryClientProvider>
    );
  });
  await settle();

  expect(container.textContent).toContain("ada@example.com · Acme");

  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Sign out"
  );

  await act(async () => {
    button?.click();
  });
  await settle();
  await settle();

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(container.querySelector("button")).toBeNull();
});
