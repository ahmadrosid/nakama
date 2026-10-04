import { expect, spyOn, test } from "bun:test";
import type { TokenOptimizationResponse } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { TokenOptimizationCard } from "./TokenOptimizationCard";

const response: TokenOptimizationResponse = {
  arms: {
    control: { arm: "control", bytesIn: 100, bytesOut: 100, calls: 2 },
    optimized: { arm: "omni", bytesIn: 100, bytesOut: 60, calls: 2 },
  },
  byTool: [],
  days: [{ bytesIn: 100, bytesRemoved: 40, day: "2026-01-01" }],
  inputTokens: {
    control: {
      arm: "control",
      estimatedTurns: 0,
      inputTokens: 0,
      inputTokensPerTurn: 0,
      turns: 0,
    },
    optimized: {
      arm: "omni",
      estimatedTurns: 0,
      inputTokens: 0,
      inputTokensPerTurn: 0,
      turns: 0,
    },
  },
  optimizers: [
    { enabled: true, id: "omni", installed: true, tools: ["web_search"] },
  ],
  totals: { bytesIn: 200, bytesRemoved: 40, calls: 4 },
  trackedSince: null,
  windowDays: 30,
};

function authValue(isPlatformAdmin: boolean): AuthContextValue {
  return {
    activeOrg: {
      createdAt: "",
      id: "org-a",
      name: "A",
      role: "admin",
      slug: "a",
      updatedAt: "",
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
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin },
  };
}

async function mountCard(isPlatformAdmin: boolean) {
  const get = spyOn(client, "getTokenOptimization").mockResolvedValue(response);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AuthContext.Provider value={authValue(isPlatformAdmin)}>
        <TokenOptimizationCard />
      </AuthContext.Provider>
    );
    await Bun.sleep(10);
  });

  const switchElement = () => {
    const element = document.querySelector<HTMLButtonElement>(
      '[aria-label="Enable omni"]'
    );
    if (!element) {
      throw new Error("Missing optimiser switch");
    }
    return element;
  };

  return {
    async cleanup() {
      get.mockRestore();
      await act(async () => root.unmount());
      container.remove();
    },
    get,
    switchElement,
    text: () => container.textContent ?? "",
  };
}

test("an org admin sees the install-wide switch locked", async () => {
  const card = await mountCard(false);
  try {
    expect(card.switchElement().disabled).toBe(true);
    expect(card.text()).toContain("A platform admin changes it");
  } finally {
    await card.cleanup();
  }
});

test("a platform admin can flip the install-wide switch", async () => {
  const card = await mountCard(true);
  const set = spyOn(client, "setTokenOptimization").mockResolvedValue({
    enabled: false,
    installError: null,
    installed: true,
  });
  try {
    expect(card.switchElement().disabled).toBe(false);
    expect(card.text()).not.toContain("A platform admin changes it");

    await act(async () => {
      card.switchElement().click();
      await Bun.sleep(10);
    });

    expect(set).toHaveBeenCalledWith(false);
  } finally {
    set.mockRestore();
    await card.cleanup();
  }
});
