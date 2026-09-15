import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";

const { createRoot } = await import("react-dom/client");
const { ConfirmDialog } = await import("@nakama/ui/dialog");
const { WhatsAppAllowedPhonesDialog } = await import(
  "./WhatsAppAllowedPhonesDialog"
);
const { client } = await import("@/lib/client");

test("confirmation cancels safely, blocks repeat submissions, and retries failures", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let calls = 0;
  let closes = 0;
  let rejectRequest: (reason: Error) => void = () => {};
  const request = new Promise<void>((_, reject) => {
    rejectRequest = reject;
  });
  const onConfirm = () => {
    calls += 1;
    return calls === 1 ? request : Promise.resolve();
  };
  const button = (label: string) => {
    const element = [...document.querySelectorAll("button")].find(
      (entry) => entry.textContent === label
    );
    if (!element) {
      throw new Error(`Missing button: ${label}`);
    }
    return element;
  };
  try {
    await act(async () => {
      root.render(
        <ConfirmDialog
          description="This deletes the item."
          onClose={() => {
            closes += 1;
          }}
          onConfirm={onConfirm}
          title="Delete item?"
        />
      );
    });
    expect(calls).toBe(0);
    await act(async () => button("Cancel").click());
    expect(calls).toBe(0);
    expect(closes).toBe(1);
    closes = 0;
    await act(async () => {
      button("Delete").click();
      button("Delete").click();
    });
    expect(calls).toBe(1);
    expect(button("Cancel").disabled).toBe(true);
    expect(button("Delete").disabled).toBe(true);
    expect(closes).toBe(0);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })
      );
    });
    expect(closes).toBe(0);
    await act(async () => rejectRequest(new Error("Request failed")));
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(closes).toBe(0);
    await act(async () => button("Delete").click());
    expect(calls).toBe(2);
    expect(closes).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("removing a WhatsApp number saves only after confirmation", async () => {
  const save = spyOn(client, "setWhatsAppSettings").mockResolvedValue(
    {} as Awaited<ReturnType<typeof client.setWhatsAppSettings>>
  );
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const changes: string[][] = [];
  const findButton = (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (entry) =>
        entry.getAttribute("aria-label") === label ||
        entry.textContent === label
    );
    if (!button) {
      throw new Error(`Missing button: ${label}`);
    }
    return button;
  };
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <WhatsAppAllowedPhonesDialog
            allowedPhones={["628123456789", "628987654321"]}
            onAllowedPhonesChange={(phones) => changes.push(phones)}
            onOpenChange={() => {}}
            open
            profileId="profile-1"
          />
        </QueryClientProvider>
      )
    );
    await act(async () => findButton("Remove +628123456789").click());
    expect(save).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    await act(async () => findButton("Cancel").click());
    expect(save).not.toHaveBeenCalled();
    await act(async () => findButton("Remove +628123456789").click());
    await act(async () => findButton("Remove").click());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({
      allowedPhones: "628987654321",
      profileId: "profile-1",
    });
    expect(changes).toEqual([["628987654321"]]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    save.mockRestore();
  }
});
