import { describe, expect, test } from "bun:test";
import { sanitizeMailError } from "./sanitize";

describe("sanitizeMailError", () => {
  test("redacts password-like content", () => {
    expect(sanitizeMailError(new Error("AUTH failed password=abcd1234"))).toBe(
      "AUTH failed password=[REDACTED]"
    );
  });

  test("keeps Gmail's hint to use an app password", () => {
    const message = sanitizeMailError(
      new Error(
        "Invalid login: 534-5.7.9 Application-specific password required."
      )
    );

    expect(message).toContain("Application-specific password");
  });

  test.each([
    "abcd efgh ijkl mnop",
    "abcd\tefgh\tijkl\tmnop",
    "abcdefghijklmnop",
    "ABCD1234efgh5678",
  ])("redacts the app password %p", (secret) => {
    expect(sanitizeMailError(new Error(`Invalid credentials: ${secret}`))).toBe(
      "Invalid credentials: [REDACTED]"
    );
  });

  test("redacts a password after a plain space", () => {
    expect(
      sanitizeMailError(new Error("AUTH failed password abcd1234"))
    ).not.toContain("abcd1234");
  });

  test("keeps a longer token whole", () => {
    const message = "Message 0123456789abcdef0 not found";

    expect(sanitizeMailError(new Error(message))).toBe(message);
  });
});
