import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { ThemeContext } from "@/context/theme-context-shared";
import { client } from "@/lib/client";
import { AcceptInvitePage } from "./AcceptInvitePage";

afterEach(() => {
  mock.restore();
  document.body.replaceChildren();
});

test("a pending invite shows the waiting screen and opens no session", async () => {
  spyOn(client, "acceptOrgInvite").mockResolvedValue({
    email: "guest@acme.com",
    orgId: "org_acme",
    pending: true,
    role: "member",
  });
  const refreshSession = mock(async () => undefined);

  const partialAuth: Partial<AuthContextValue> = { refreshSession };

  // SAFETY: AcceptInvitePage reads only refreshSession from the auth context.
  const auth = partialAuth as AuthContextValue;

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/accept-invite?token=tok"]}>
        <AuthContext.Provider value={auth}>
          <ThemeContext.Provider
            value={{
              resolvedTheme: "light",
              setTheme: () => {},
              theme: "light",
              toggleTheme: () => {},
            }}
          >
            <AcceptInvitePage />
          </ThemeContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>
    );
  });

  const password = container.querySelector<HTMLInputElement>("#password");

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set?.call(password, "guest-password");
    password?.dispatchEvent(new window.Event("input", { bubbles: true }));
  });

  await act(async () => {
    container.querySelector("form")?.requestSubmit();
  });

  expect(container.querySelector("h1")?.textContent).toBe(
    "Waiting for approval"
  );
  expect(refreshSession).not.toHaveBeenCalled();

  await act(async () => root.unmount());
});
