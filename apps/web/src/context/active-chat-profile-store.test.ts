import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useActiveChatProfileStore } from "@/context/active-chat-profile-store";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
  return () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  };
}

describe("active chat profile store", () => {
  let restoreStorage: (() => void) | undefined;

  beforeEach(() => {
    restoreStorage = installMemoryStorage();
    useActiveChatProfileStore.setState({ orgId: null, profileId: null });
  });

  afterEach(() => {
    restoreStorage?.();
  });

  test("syncForOrg picks a known profile for the new org", () => {
    useActiveChatProfileStore.getState().setProfileId("personal-bot");
    useActiveChatProfileStore.setState({ orgId: "org-personal" });

    const resolved = useActiveChatProfileStore.getState().syncForOrg({
      orgId: "org-work",
      profiles: [{ id: "default" }, { id: "work-bot" }],
    });

    expect(resolved).toBe("default");
    expect(useActiveChatProfileStore.getState()).toMatchObject({
      orgId: "org-work",
      profileId: "default",
    });
  });

  test("syncForOrg restores the last profile for an org", () => {
    useActiveChatProfileStore.getState().syncForOrg({
      orgId: "org-work",
      preferredProfileId: "work-bot",
      profiles: [{ id: "default" }, { id: "work-bot" }],
    });
    useActiveChatProfileStore.getState().syncForOrg({
      orgId: "org-personal",
      profiles: [{ id: "personal-bot" }],
    });

    const resolved = useActiveChatProfileStore.getState().syncForOrg({
      orgId: "org-work",
      profiles: [{ id: "default" }, { id: "work-bot" }],
    });

    expect(resolved).toBe("work-bot");
  });
});
