import { expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";

const { createRoot } = await import("react-dom/client");
const { ConfirmDialog } = await import("@nakama/ui/dialog");
const { WhatsAppAllowedPhonesDialog } = await import(
  "./WhatsAppAllowedPhonesDialog"
);
const { client } = await import("@/lib/client");
const { useClearWorkerLogs } = await import("@/hooks/use-worker-logs");
const whatsappAuth: AuthContextValue = {
  activeOrg: {
    createdAt: "2026-09-17T00:00:00Z",
    id: "org-a",
    name: "A",
    role: "admin",
    slug: "a",
    updatedAt: "2026-09-17T00:00:00Z",
  },
  archiveOrg: async () => {},
  createOrg: async () => {},
  isAuthenticated: true,
  isLoading: false,
  login: async () => ({ email: "admin@example.com", id: "admin" }),
  logout: async () => {},
  orgs: [],
  refreshSession: async () => {},
  setup: async () => {},
  switchOrg: async () => {},
  updateOrg: async () => {},
  user: null,
};

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
  const api = client.forOrg("org-a");
  const scoped = spyOn(client, "forOrg").mockReturnValue(api);
  const save = spyOn(api, "setWhatsAppSettings").mockResolvedValue(
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
          <AuthContext.Provider value={whatsappAuth}>
            <WhatsAppAllowedPhonesDialog
              allowedPhones={["628123456789", "628987654321"]}
              onAllowedPhonesChange={(phones) => changes.push(phones)}
              onOpenChange={() => {}}
              open
              profileId="profile-1"
            />
          </AuthContext.Provider>
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
    expect(scoped).toHaveBeenCalledWith("org-a");
    expect(save).toHaveBeenCalledWith(
      {
        allowedPhones: "628987654321",
        profileId: "profile-1",
      },
      "profile-1"
    );
    expect(changes).toEqual([["628987654321"]]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    save.mockRestore();
    scoped.mockRestore();
  }
});

test("clearing WhatsApp logs stays in its original org after switching", async () => {
  const apiA = client.forOrg("org-a");
  const apiB = client.forOrg("org-b");
  const scoped = spyOn(client, "forOrg").mockImplementation((orgId) =>
    orgId === "org-a" ? apiA : apiB
  );
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const clearA = spyOn(apiA, "clearWorkerLogs").mockImplementation(async () => {
    await pending;
    return { ok: true };
  });
  const clearB = spyOn(apiB, "clearWorkerLogs").mockResolvedValue({ ok: true });
  const queryClient = new QueryClient();
  const keyA = ["workerLogs", "whatsapp", "org-a", 500];
  const keyB = ["workerLogs", "whatsapp", "org-b", 500];
  queryClient.setQueryData(keyA, { stderr: "", stdout: "a" });
  queryClient.setQueryData(keyB, { stderr: "", stdout: "b" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let clear: () => Promise<unknown> = async () => {};
  function Probe() {
    clear = useClearWorkerLogs("whatsapp").mutateAsync;
    return null;
  }
  const render = (id: string) =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            ...whatsappAuth,
            activeOrg: { ...whatsappAuth.activeOrg!, id },
          }}
        >
          <Probe />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  try {
    await act(async () => render("org-a"));
    let result: Promise<unknown> = Promise.resolve();
    await act(async () => {
      result = clear();
    });
    await act(async () => render("org-b"));
    await act(async () => {
      finish();
      await result;
    });
    expect(clearA).toHaveBeenCalledWith("whatsapp", undefined);
    expect(clearB).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData<{ stderr: string; stdout: string }>(keyA)
    ).toEqual({ stderr: "", stdout: "" });
    expect(
      queryClient.getQueryData<{ stderr: string; stdout: string }>(keyB)
    ).toEqual({ stderr: "", stdout: "b" });
  } finally {
    finish();
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    scoped.mockRestore();
    clearA.mockRestore();
    clearB.mockRestore();
  }
});
