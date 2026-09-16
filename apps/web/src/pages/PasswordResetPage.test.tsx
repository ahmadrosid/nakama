import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ThemeContext } from "@/context/theme-context-shared";
import { PasswordResetPage } from "@/pages/PasswordResetPage";

const theme = {
  resolvedTheme: "light" as const,
  setTheme: () => undefined,
  theme: "system" as const,
  toggleTheme: () => undefined,
};

function renderPage(path: string): string {
  return renderToString(
    <ThemeContext.Provider value={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<PasswordResetPage />} path="/reset-password" />
        </Routes>
      </MemoryRouter>
    </ThemeContext.Provider>
  );
}

describe("PasswordResetPage", () => {
  test("offers manual token entry when no link token is present", () => {
    const html = renderPage("/reset-password");

    expect(html).toContain("Use reset token");
    expect(html).not.toContain('id="reset-token"');
  });

  test("shows the token field for a reset link", () => {
    const html = renderPage("/reset-password?token=tc_reset_example");

    expect(html).toContain('id="reset-token"');
    expect(html).toContain('value="tc_reset_example"');
  });
});
