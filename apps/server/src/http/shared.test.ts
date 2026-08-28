import { describe, expect, test } from "bun:test";
import { readOptionalJson } from "./shared";

const URL = "http://localhost:4310/test";

describe("readOptionalJson", () => {
  test("returns the fallback for an empty optional body", async () => {
    const request = new Request(URL, { body: " \n", method: "POST" });

    await expect(
      readOptionalJson(request, { enabled: false })
    ).resolves.toEqual({ enabled: false });
  });

  test("rejects malformed non-empty JSON", async () => {
    const request = new Request(URL, { body: "{", method: "POST" });

    await expect(readOptionalJson(request, {})).rejects.toMatchObject({
      status: 400,
    });
  });
});
