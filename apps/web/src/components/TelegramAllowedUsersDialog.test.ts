import { describe, expect, test } from "bun:test";
import { parseAllowedTelegramUsers } from "./TelegramAllowedUsersDialog";

describe("parseAllowedTelegramUsers", () => {
  test("accepts numeric from.id in pasted JSON", () => {
    expect(
      parseAllowedTelegramUsers(
        JSON.stringify({ message: { from: { id: 12_345, username: "alice" } } })
      )
    ).toEqual([{ id: "12345", username: "alice" }]);
  });

  test("rejects object ids that stringify to fake numeric text", () => {
    expect(() =>
      parseAllowedTelegramUsers(
        JSON.stringify({
          from: {
            id: {
              toString() {
                return "999";
              },
            },
          },
        })
      )
    ).toThrow(/numeric user ID/i);
  });

  test("rejects string ids in JSON payloads", () => {
    expect(() =>
      parseAllowedTelegramUsers(JSON.stringify({ from: { id: "12345" } }))
    ).toThrow(/numeric user ID/i);
  });

  test("still accepts plain numeric ids", () => {
    expect(parseAllowedTelegramUsers("12345, 67890")).toEqual([
      { id: "12345" },
      { id: "67890" },
    ]);
  });
});
