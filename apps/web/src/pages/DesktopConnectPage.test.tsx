import { afterEach, expect, spyOn, test } from "bun:test";
import { NakamaClient } from "@nakama/client";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeContext } from "@/context/theme-context-shared";
import { connectReturnUrl, parseConnectRequest } from "@/lib/desktop-connect";
import { DesktopConnectPage } from "./DesktopConnectPage";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const link = new URLSearchParams({
  install: "install_0001",
  key: "a2V5",
  name: "Ada's MacBook",
  return: "http://127.0.0.1:53111/callback",
  state: "state_123",
});

// SAFETY: DesktopConnectPage reads only activeOrg, orgs and user.
const auth = {
  activeOrg: {
    createdAt: "",
    id: "org_a",
    name: "Acme",
    role: "member",
    slug: "acme",
    updatedAt: "",
  },
  orgs: [
    {
      createdAt: "",
      id: "org_a",
      name: "Acme",
      role: "member",
      slug: "acme",
      updatedAt: "",
    },
  ],
  user: { email: "ada@example.com", id: "user_ada", isPlatformAdmin: false },
} as AuthContextValue;

test("a link must come back to 127.0.0.1 on this computer and carry every field", () => {
  expect(parseConnectRequest(link)?.returnTo).toBe(
    "http://127.0.0.1:53111/callback"
  );

  for (const returnTo of [
    "https://evil.example/callback",
    "http://localhost:53111/callback",
    "http://127.0.0.1.evil.example:53111/",
    "http://user@127.0.0.1:53111/",
  ]) {
    const changed = new URLSearchParams(link);
    changed.set("return", returnTo);
    expect(parseConnectRequest(changed)).toBeNull();
  }

  const missing = new URLSearchParams(link);
  missing.delete("state");
  expect(parseConnectRequest(missing)).toBeNull();
});

test("the return address carries the state and the new computer", () => {
  const request = parseConnectRequest(link);

  if (!request) {
    throw new Error("The test link must parse.");
  }

  const url = new URL(
    connectReturnUrl(request, {
      account: "ada@example.com",
      computerId: "computer_1",
      confirmCode: "code_1",
      orgId: "org_a",
      orgName: "Acme",
    })
  );

  expect(url.origin).toBe("http://127.0.0.1:53111");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    account: "ada@example.com",
    computerId: "computer_1",
    confirmCode: "code_1",
    orgId: "org_a",
    orgName: "Acme",
    state: "state_123",
  });
});

test("Connect enrolls the key for the org, and a bad link shows no Connect button", async () => {
  const enroll = spyOn(
    NakamaClient.prototype,
    "enrollComputer"
  ).mockImplementation(async () => ({
    computerId: "computer_1",
    confirmCode: "code_1",
  }));

  const assigned: string[] = [];

  const assign = spyOn(window.location, "assign").mockImplementation(
    (url: string | URL) => {
      assigned.push(String(url));
    }
  );

  const render = (search: string) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    act(() => {
      root.render(
        <ThemeContext.Provider
          value={{
            resolvedTheme: "light",
            setTheme: () => undefined,
            theme: "light",
            toggleTheme: () => undefined,
          }}
        >
          <AuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={[`/desktop/connect?${search}`]}>
              <DesktopConnectPage />
            </MemoryRouter>
          </AuthContext.Provider>
        </ThemeContext.Provider>
      );
    });

    return container;
  };

  cleanups.push(() => {
    enroll.mockRestore();
    assign.mockRestore();
  });

  const bad = new URLSearchParams(link);
  bad.set("return", "https://evil.example/");
  expect(
    [...render(bad.toString()).querySelectorAll("button")].some(
      (button) => button.textContent === "Connect"
    )
  ).toBe(false);

  const page = render(link.toString());

  const button = [...page.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "Connect"
  );

  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(enroll).toHaveBeenCalledWith({
    installId: "install_0001",
    name: "Ada's MacBook",
    publicKey: "a2V5",
  });
  expect(
    new URL(assigned[0] ?? "http://x").searchParams.get("computerId")
  ).toBe("computer_1");
});
