import { describe, expect, test } from "bun:test";
import { sanitizeMailError } from "./sanitize";

describe("sanitizeMailError", () => {
  test("redacts password-like content", () => {
    expect(sanitizeMailError(new Error("AUTH failed password=abcd1234"))).toBe(
      "AUTH failed password=[REDACTED]"
    );
  });

  test("redacts a labeled credential across SMTP response lines", () => {
    expect(
      sanitizeMailError(new Error("AUTH failed password:\r\ntest-only"))
    ).toBe("AUTH failed password=[REDACTED]");
  });

  test.each([
    "Invalid login: 534-5.7.9 Application-specific password required.",
    "Invalid login: 535-5.7.8 Username and Password not accepted",
  ])("still redacts a credential after the Gmail hint %p", (hint) => {
    expect(
      sanitizeMailError(
        new Error(hint + "\nAUTH failed password:\nfixture-only")
      )
    ).toBe(hint + "\nAUTH failed password=[REDACTED]");
  });

  test("keeps Gmail's hint to use an app password", () => {
    const message = sanitizeMailError(
      new Error(
        "Invalid login: 534-5.7.9 Application-specific password required."
      )
    );

    expect(message).toBe(
      "Invalid login: 534-5.7.9 Application-specific password required."
    );
  });

  test("keeps Gmail's wrong-password message", () => {
    const message =
      "Invalid login: 535-5.7.8 Username and Password not accepted";

    expect(sanitizeMailError(new Error(message))).toBe(message);
  });

  test.each([
    "abcd efgh ijkl mnop",
    "abcd\tefgh\tijkl\tmnop",
    "abcdefghijklmnop",
    "ABCD1234efgh5678",
    "abcd efgh ijklmnop",
    "abcdefgh ijklmnop",
    "abcd  efgh  ijkl  mnop",
    "abcd-efgh-ijkl-mnop",
    "ABCD EFGH IJKL MNOP",
    "ab12 cd34 ef56 gh78",
    "prefixpasswordxy",
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

  test("redacts a spaced app password after the word password", () => {
    expect(sanitizeMailError(new Error("password abcd efgh ijkl mnop"))).toBe(
      "password=[REDACTED]"
    );
  });

  test("redacts an app password after an underscore", () => {
    expect(sanitizeMailError(new Error("pw_abcdefghijklmnop"))).toBe(
      "pw_[REDACTED]"
    );
  });

  test("redacts a password of only letters", () => {
    expect(
      sanitizeMailError(new Error("AUTH failed password hunterpass"))
    ).toBe("AUTH failed password=[REDACTED]");
  });

  test.each([
    "535 your password must be changed",
    "Invalid login: 535 your password must be changed",
  ])("keeps a recognized password-change hint %p", (message) => {
    expect(sanitizeMailError(new Error(message))).toBe(message);
  });

  test("keeps a longer token whole", () => {
    const message = "Message 0123456789abcdef0 not found";

    expect(sanitizeMailError(new Error(message))).toBe(message);
  });
});
